const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { validateId, validatePhone, safeName, safeText } = require('../validate');
const { parseWorkingHours, isWorkingDay, getWorkingHoursForDay, generateTimeSlots } = require('../schedule');
const {
  VALID_STATUSES,
  VALID_PAYMENT_METHODS,
  VALID_PAYMENT_STATUSES,
  VALID_DELIVERY,
  VALID_UNITS,
  VALID_GARMENT_TYPES,
  MAX_IRONING_ITEMS_PER_BOOKING,
  IRONING_DEFAULT_TURNAROUND_DAYS,
  MAX_TURNAROUND_DAYS,
  isValidTransition,
  isValidPaymentTransition,
  validateBookingMeasurements,
} = require('../bookingRules');

const router = express.Router();
const bookingRateLimit = rateLimit({ windowMs: 60000, max: 10 });

function dateOnly(value) {
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

router.get('/tailor/:tailorId', authenticateToken, async (req, res) => {
  try {
    if (!validateId(req.params.tailorId)) return res.status(400).json({ error: 'Invalid tailor ID' });
    if (req.auth.type !== 'tailor') return res.status(403).json({ error: 'Tailor account required' });
    if (req.auth.id !== req.params.tailorId) {
      return res.status(403).json({ error: 'Cannot view another tailor\'s bookings' });
    }
    const result = await pool.query(
      'SELECT * FROM bookings WHERE tailor_id = $1 ORDER BY created_at DESC',
      [req.auth.id]
    );
    return res.json({ bookings: result.rows });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.get('/customer', authenticateToken, async (req, res) => {
  try {
    if (req.auth.type !== 'user') return res.status(403).json({ error: 'Customer access required' });
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const statusFilter = req.query.status;

    let whereClause = 'WHERE customer_id = $1';
    const params = [req.auth.id];
    let paramIdx = 2;

    if (statusFilter && statusFilter !== 'all') {
      const statusMap = {
        active: ['booked', 'confirmed', 'inProgress', 'readyForPickup'],
        completed: ['completed'],
        cancelled: ['cancelled'],
      };
      const statuses = statusMap[String(statusFilter).toLowerCase()];
      if (statuses) {
        whereClause += ` AND status = ANY($${paramIdx})`;
        params.push(statuses);
        paramIdx += 1;
      }
    }

    const countResult = await pool.query(`SELECT COUNT(*) FROM bookings ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count, 10);
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT * FROM bookings ${whereClause} ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );
    return res.json({
      items: result.rows,
      page,
      limit,
      total,
      hasNext: offset + limit < total,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.post('/', authenticateToken, bookingRateLimit, async (req, res) => {
  if (req.auth.type !== 'user') return res.status(403).json({ error: 'Customer account required' });
  const client = await pool.connect();
  try {
    const {
      tailorId, customerName, customerPhone, garmentType, slotDate, deliveryDate,
      deliveryMethod, notes, timeSlot, stitchingSpeedId, ironingItems,
      pickupAddress, pickupLatitude, pickupLongitude, pickupLandmark, pickupPhone,
    } = req.body;
    if (!tailorId || !customerName || !customerPhone || !garmentType || !slotDate || !deliveryDate) {
      return res.status(400).json({ error: 'Missing required booking fields' });
    }
    if (!validateId(tailorId)) return res.status(400).json({ error: 'Invalid tailor ID' });
    if (!safeName(customerName)) return res.status(400).json({ error: 'Invalid customer name' });
    if (!validatePhone(customerPhone)) return res.status(400).json({ error: 'Invalid customer phone' });
    if (deliveryMethod && !VALID_DELIVERY.includes(deliveryMethod)) {
      return res.status(400).json({ error: 'Invalid delivery method' });
    }

    await client.query('BEGIN');
    const tailorResult = await client.query(
      'SELECT id, name, prices, item_prices, shop_type, working_hours, slot_duration, stitching_days, base_delivery_charge FROM tailors WHERE id = $1',
      [tailorId]
    );
    if (tailorResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Tailor not found' });
    }
    const tailor = tailorResult.rows[0];
    const isIronShop = tailor.shop_type === 'iron';
    const isTailoringShop = tailor.shop_type === 'tailor';
    if (!isIronShop && !isTailoringShop) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Shop type is not configured; bookings are unavailable for this shop' });
    }
    if (isIronShop && stitchingSpeedId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Stitching speed options are not available for ironing bookings' });
    }
    if (!isIronShop && Array.isArray(ironingItems) && ironingItems.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ironing items are not available for tailoring bookings' });
    }

    let speedRow = null;
    if (stitchingSpeedId) {
      if (!validateId(stitchingSpeedId)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid stitching speed ID' });
      }
      const speedResult = await client.query(
        'SELECT * FROM tailor_stitching_speeds WHERE id = $1 AND tailor_id = $2 AND is_enabled = 1',
        [stitchingSpeedId, tailorId]
      );
      if (speedResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Selected stitching speed is not offered by this tailor' });
      }
      speedRow = speedResult.rows[0];
    }

    const validatedIronItems = [];
    if (Array.isArray(ironingItems) && ironingItems.length > 0) {
      if (ironingItems.length > MAX_IRONING_ITEMS_PER_BOOKING) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Maximum ${MAX_IRONING_ITEMS_PER_BOOKING} items per booking` });
      }
      for (const item of ironingItems) {
        const serviceTypeId = item && item.serviceTypeId;
        const quantity = item ? parseInt(item.quantity, 10) : 0;
        if (!serviceTypeId || !validateId(serviceTypeId)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Each ironing item needs a valid service type' });
        }
        if (!Number.isFinite(quantity) || quantity < 1 || quantity > 100) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Item quantity must be 1-100' });
        }
        const serviceResult = await client.query(
          'SELECT * FROM ironing_service_types WHERE id = $1 AND tailor_id = $2 AND is_enabled = 1',
          [serviceTypeId, tailorId]
        );
        if (serviceResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'One of the selected ironing services is not offered by this tailor' });
        }
        validatedIronItems.push({
          serviceTypeId,
          serviceName: serviceResult.rows[0].name,
          pricePerItem: Number(serviceResult.rows[0].price_per_item) || 0,
          quantity,
          customerNote: item.customerNote ? String(item.customerNote).slice(0, 500) : null,
        });
      }
    }

    if (isIronShop && validatedIronItems.length === 0 && Array.isArray(req.body.items)) {
      let legacyPrices = {};
      try { legacyPrices = JSON.parse(tailor.item_prices || '{}'); } catch (e) { legacyPrices = {}; }
      for (const item of req.body.items) {
        const itemType = item && typeof item.itemType === 'string' ? item.itemType.trim().slice(0, 100) : '';
        const quantity = item ? parseInt(item.quantity, 10) : 0;
        if (!itemType || !Number.isFinite(quantity) || quantity < 1 || quantity > 100) continue;
        validatedIronItems.push({
          serviceTypeId: null,
          serviceName: itemType,
          pricePerItem: Number(legacyPrices[itemType]) || 0,
          quantity,
          customerNote: null,
        });
      }
    }

    const cleanPickupAddress = pickupAddress ? String(pickupAddress).trim().slice(0, 300) : null;
    const cleanPickupLandmark = pickupLandmark ? String(pickupLandmark).trim().slice(0, 200) : null;
    const cleanPickupPhone = pickupPhone ? String(pickupPhone).trim() : null;
    if (cleanPickupPhone && !validatePhone(cleanPickupPhone)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid pickup phone' });
    }
    const pickupLat = pickupLatitude !== undefined && pickupLatitude !== null && pickupLatitude !== '' ? Number(pickupLatitude) : null;
    const pickupLng = pickupLongitude !== undefined && pickupLongitude !== null && pickupLongitude !== '' ? Number(pickupLongitude) : null;
    if ((pickupLat !== null && !Number.isFinite(pickupLat)) || (pickupLng !== null && !Number.isFinite(pickupLng))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid pickup coordinates' });
    }

    const workingHours = parseWorkingHours(tailor.working_hours);
    const slotDateStr = dateOnly(slotDate);
    if (!isWorkingDay(workingHours, slotDateStr)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Selected date is not a working day' });
    }
    const dayHours = getWorkingHoursForDay(workingHours, slotDateStr);
    const duration = tailor.slot_duration || 60;
    const validSlots = (dayHours && dayHours.enabled)
      ? generateTimeSlots(dayHours.open, dayHours.close, duration)
      : ['10:00 AM', '11:30 AM', '2:00 PM', '4:00 PM', '5:30 PM'];
    const selectedTimeSlot = timeSlot && validSlots.includes(timeSlot) ? timeSlot : validSlots[0] || '10:00 AM';

    const deliveryChargeAmount = deliveryMethod === 'door_delivery'
      ? Math.max(0, Number(tailor.base_delivery_charge) || 0)
      : 0;
    let serverCalculatedAmount = 0;
    try {
      const prices = JSON.parse(tailor.prices || '{}');
      if (isIronShop) {
        for (const item of validatedIronItems) {
          serverCalculatedAmount += item.pricePerItem * item.quantity;
        }
      } else {
        serverCalculatedAmount = Number(prices[garmentType]) || 0;
        if (speedRow) serverCalculatedAmount += Number(speedRow.extra_charge) || 0;
      }
    } catch (e) {
      serverCalculatedAmount = 0;
    }
    const finalAmount = serverCalculatedAmount + deliveryChargeAmount;

    let expectedCompletionDate = null;
    const baseDate = new Date(`${slotDateStr}T00:00:00.000Z`);
    if (!Number.isNaN(baseDate.getTime())) {
      let turnaroundDays;
      if (speedRow) {
        turnaroundDays = Math.max(0, parseInt(speedRow.turnaround_days, 10) || 0);
      } else if (isIronShop) {
        const stitchingDays = parseInt(tailor.stitching_days, 10);
        turnaroundDays = Number.isFinite(stitchingDays) && stitchingDays >= 1
          ? stitchingDays
          : IRONING_DEFAULT_TURNAROUND_DAYS;
      } else {
        let garmentDays = null;
        try {
          const parsed = JSON.parse(tailor.stitching_days || '{}');
          garmentDays = parseInt(parsed[garmentType], 10);
        } catch (e) {
          garmentDays = null;
        }
        turnaroundDays = Number.isFinite(garmentDays) && garmentDays >= 0 ? garmentDays : 3;
      }
      turnaroundDays = Math.min(turnaroundDays, MAX_TURNAROUND_DAYS);
      baseDate.setUTCDate(baseDate.getUTCDate() + turnaroundDays);
      expectedCompletionDate = baseDate.toISOString().slice(0, 10);
    }

    const slotResult = await client.query(
      'SELECT id, max_customers, booked_customers, is_blocked FROM slots WHERE tailor_id = $1 AND date = $2 AND time_slot = $3 FOR UPDATE',
      [tailorId, slotDateStr, selectedTimeSlot]
    );
    if (slotResult.rows.length > 0) {
      const slot = slotResult.rows[0];
      if (slot.is_blocked) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This time slot is blocked by the tailor' });
      }
      if (slot.booked_customers >= slot.max_customers) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This time slot is fully booked' });
      }
      await client.query(
        'UPDATE slots SET booked_customers = booked_customers + 1 WHERE id = $1 AND booked_customers < max_customers',
        [slot.id]
      );
      const verify = await client.query('SELECT booked_customers, max_customers FROM slots WHERE id = $1', [slot.id]);
      if (verify.rows[0].booked_customers > verify.rows[0].max_customers) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Slot just became full' });
      }
    } else {
      await client.query(
        'INSERT INTO slots (id, tailor_id, date, time_slot, max_customers, booked_customers, is_blocked) VALUES ($1,$2,$3,$4,3,1,0)',
        [crypto.randomUUID(), tailorId, slotDateStr, selectedTimeSlot]
      );
    }

    const id = crypto.randomUUID();
    const booking = {
      id,
      reference_number: `SB-${crypto.randomUUID().slice(0, 10).toUpperCase()}`,
      tailor_id: tailorId,
      tailor_name: tailor.name,
      customer_id: req.auth.id,
      customer_name: customerName.trim(),
      customer_phone: customerPhone,
      customer_whatsapp: req.body.customerWhatsApp || null,
      garment_type: garmentType,
      amount: finalAmount,
      payment_method: VALID_PAYMENT_METHODS.includes(req.body.paymentMethod) ? req.body.paymentMethod : 'cash',
      payment_status: 'pending',
      slot_date: typeof slotDate === 'string' ? slotDate : new Date(slotDate).toISOString(),
      delivery_date: typeof deliveryDate === 'string' ? deliveryDate : new Date(deliveryDate).toISOString(),
      status: 'booked',
      notes: notes ? String(notes).slice(0, 2000) : null,
      tailor_notes: null,
      delivery_method: deliveryMethod || 'pickup',
      delivery_charge: deliveryChargeAmount,
      stitching_speed_id: speedRow ? speedRow.id : null,
      ironing_service_type_id: validatedIronItems.length > 0 ? validatedIronItems[0].serviceTypeId : null,
      pickup_address: cleanPickupAddress,
      pickup_latitude: pickupLat,
      pickup_longitude: pickupLng,
      pickup_landmark: cleanPickupLandmark,
      pickup_phone: cleanPickupPhone,
      expected_completion_date: expectedCompletionDate,
      actual_completion_date: null,
      created_at: new Date().toISOString(),
      updated_at: null,
    };
    const columns = Object.keys(booking);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    await client.query(
      `INSERT INTO bookings (${columns.join(', ')}) VALUES (${placeholders})`,
      Object.values(booking)
    );

    const createdIroningItems = [];
    if (isIronShop && validatedIronItems.length > 0) {
      const nowIso = new Date().toISOString();
      for (const item of validatedIronItems) {
        const itemId = crypto.randomUUID();
        await client.query(
          `INSERT INTO booking_ironing_items (
            id, booking_id, service_type_id, service_type_name, quantity, price_per_item, customer_note, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [itemId, id, item.serviceTypeId, item.serviceName, item.quantity, item.pricePerItem, item.customerNote, nowIso, nowIso]
        );
        createdIroningItems.push({
          id: itemId,
          serviceTypeId: item.serviceTypeId,
          serviceTypeName: item.serviceName,
          quantity: item.quantity,
          pricePerItem: item.pricePerItem,
          customerNote: item.customerNote,
        });
      }
    }

    const clientMeasurements = isIronShop ? null : req.body.measurements;
    if (clientMeasurements && typeof clientMeasurements === 'object') {
      const unit = VALID_UNITS.includes(clientMeasurements.unit) ? clientMeasurements.unit : 'cm';
      const garment = VALID_GARMENT_TYPES.includes(garmentType) ? garmentType : 'general';
      const values = clientMeasurements.values || clientMeasurements;
      const measurementCheck = validateBookingMeasurements(values);
      if (measurementCheck.valid && Object.keys(values).length > 0) {
        const now = new Date().toISOString();
        await client.query(
          `INSERT INTO booking_measurements (
            id, booking_id, user_id, tailor_id, garment_type, unit, measurements, source, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [crypto.randomUUID(), id, req.auth.id, tailorId, garment, unit, JSON.stringify(values), 'customer', now, now]
        );
      }
    }

    await client.query('COMMIT');
    return res.json({ booking, ironingItems: createdIroningItems });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { /* transaction already closed */ }
    return res.status(500).json({ error: 'Booking failed' });
  } finally {
    client.release();
  }
});

router.put('/:id/status', authenticateToken, async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid booking ID' });
    const { status, tailorNotes } = req.body;
    if (!status || !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status value' });
    const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = result.rows[0];

    if (req.auth.type === 'tailor') {
      if (req.auth.id !== booking.tailor_id) {
        return res.status(403).json({ error: 'Cannot modify another tailor\'s booking' });
      }
    } else if (req.auth.type === 'user') {
      if (!booking.customer_id || booking.customer_id !== req.auth.id) {
        return res.status(403).json({ error: 'Cannot modify another customer\'s booking' });
      }
      if (status !== 'cancelled') return res.status(403).json({ error: 'Customers can only cancel bookings' });
      if (!['booked', 'confirmed'].includes(booking.status)) {
        return res.status(400).json({ error: 'Cannot cancel booking in current state' });
      }
    } else {
      return res.status(403).json({ error: 'Invalid account type' });
    }

    if (!isValidTransition(booking.status, status)) {
      return res.status(400).json({ error: `Cannot transition from "${booking.status}" to "${status}"` });
    }

    const updatedAt = new Date().toISOString();
    if (status === 'completed') {
      await pool.query(
        'UPDATE bookings SET status=$1, tailor_notes=$2, updated_at=$3, actual_completion_date=$4 WHERE id=$5',
        [status, tailorNotes || booking.tailor_notes, updatedAt, updatedAt, req.params.id]
      );
    } else {
      await pool.query(
        'UPDATE bookings SET status=$1, tailor_notes=$2, updated_at=$3 WHERE id=$4',
        [status, tailorNotes || booking.tailor_notes, updatedAt, req.params.id]
      );
    }
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Update failed' });
  }
});

router.put('/:id/payment-status', authenticateToken, async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid booking ID' });
    const { paymentStatus } = req.body;
    if (!paymentStatus || !VALID_PAYMENT_STATUSES.includes(paymentStatus)) {
      return res.status(400).json({ error: 'Invalid payment status' });
    }
    const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = result.rows[0];
    if (req.auth.type !== 'tailor' || req.auth.id !== booking.tailor_id) {
      return res.status(403).json({ error: 'Only the owning tailor can update payment status' });
    }
    if (!isValidPaymentTransition(booking.payment_status, paymentStatus)) {
      return res.status(400).json({ error: `Cannot transition payment from "${booking.payment_status}" to "${paymentStatus}"` });
    }
    await pool.query(
      'UPDATE bookings SET payment_status=$1, updated_at=$2 WHERE id=$3',
      [paymentStatus, new Date().toISOString(), req.params.id]
    );
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Update failed' });
  }
});

router.put('/:id/notes', authenticateToken, async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid booking ID' });
    const { notes } = req.body;
    if (!notes || !safeText(notes, 2000)) return res.status(400).json({ error: 'Notes are required (max 2000 chars)' });
    const result = await pool.query(
      'SELECT notes, tailor_id, customer_id FROM bookings WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = result.rows[0];
    if (req.auth.type === 'tailor') {
      if (req.auth.id !== booking.tailor_id) {
        return res.status(403).json({ error: 'Cannot modify another tailor\'s booking' });
      }
    } else if (req.auth.type === 'user') {
      if (!booking.customer_id || booking.customer_id !== req.auth.id) {
        return res.status(403).json({ error: 'Cannot modify another customer\'s booking' });
      }
    } else {
      return res.status(403).json({ error: 'Invalid account type' });
    }
    const current = booking.notes || '';
    const timestamped = current
      ? `${current}\n[${new Date().toISOString().slice(0, 16)}] ${notes.trim()}`
      : notes.trim();
    await pool.query('UPDATE bookings SET notes=$1 WHERE id=$2', [timestamped, req.params.id]);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Update failed' });
  }
});

module.exports = router;
