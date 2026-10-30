const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { validateId, safeText } = require('../validate');
const { VALID_STATUSES, VALID_PAYMENT_STATUSES, isValidTransition, isValidPaymentTransition } = require('../bookingRules');
const { notify } = require('../notify');

const router = express.Router();

function requireInternal(req, res, next) {
  const expected = process.env.INTERNAL_TOKEN;
  const provided = req.headers['x-internal-token'];
  if (!expected || typeof provided !== 'string') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

router.use(requireInternal);

router.get('/bookings/by-order/:orderId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM bookings WHERE razorpay_order_id = $1', [req.params.orderId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    return res.json({ booking: result.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.get('/bookings/by-payment/:paymentId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM bookings WHERE razorpay_payment_id = $1', [req.params.paymentId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    return res.json({ booking: result.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.get('/bookings/:id', async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid booking ID' });
    const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    return res.json({ booking: result.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.patch('/bookings/:id/payment', async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid booking ID' });
    const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = result.rows[0];
    const { paymentStatus, razorpayOrderId, razorpayPaymentId } = req.body;

    if (paymentStatus !== undefined) {
      if (!VALID_PAYMENT_STATUSES.includes(paymentStatus)) {
        return res.status(400).json({ error: 'Invalid payment status' });
      }
      if (paymentStatus !== booking.payment_status && !isValidPaymentTransition(booking.payment_status, paymentStatus)) {
        return res.status(409).json({
          error: 'Invalid payment transition',
          current: booking.payment_status,
        });
      }
    }

    await pool.query(
      `UPDATE bookings
       SET payment_status = COALESCE($1, payment_status),
           razorpay_order_id = COALESCE($2, razorpay_order_id),
           razorpay_payment_id = COALESCE($3, razorpay_payment_id),
           updated_at = $4
       WHERE id = $5`,
      [
        paymentStatus || null,
        razorpayOrderId || null,
        razorpayPaymentId || null,
        new Date().toISOString(),
        req.params.id,
      ]
    );
    const updated = await pool.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    return res.json({ booking: updated.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Update failed' });
  }
});

const SHOP_COLUMNS = `
  id, name, phone, email, shop_description, address, latitude, longitude,
  average_rating, total_ratings, shop_type, is_active, profile_image_url
`;

router.get('/admin/summary', async (req, res) => {
  try {
    const [users, shops, activeShops, bookings] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM tailors'),
      pool.query('SELECT COUNT(*) FROM tailors WHERE is_active = 1'),
      pool.query('SELECT COUNT(*) FROM bookings'),
    ]);
    return res.json({
      users: parseInt(users.rows[0].count, 10),
      shops: parseInt(shops.rows[0].count, 10),
      activeShops: parseInt(activeShops.rows[0].count, 10),
      bookings: parseInt(bookings.rows[0].count, 10),
    });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.get('/admin/shops', async (req, res) => {
  try {
    const result = await pool.query(`SELECT ${SHOP_COLUMNS} FROM tailors ORDER BY name`);
    return res.json({ shops: result.rows });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.patch('/admin/shops/:id/active', async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid shop ID' });
    const isActive = req.body.isActive;
    if (isActive !== 0 && isActive !== 1) return res.status(400).json({ error: 'isActive must be 0 or 1' });
    const result = await pool.query(
      `UPDATE tailors SET is_active = $1 WHERE id = $2 RETURNING ${SHOP_COLUMNS}`,
      [isActive, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Shop not found' });
    return res.json({ shop: result.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Update failed' });
  }
});

function actorCanChange(booking, actorId, actorType, status) {
  if (actorType === 'tailor') {
    if (actorId !== booking.tailor_id) return { status: 403, error: 'Cannot modify another tailor\'s booking' };
    return null;
  }
  if (actorType === 'user') {
    if (!booking.customer_id || booking.customer_id !== actorId) {
      return { status: 403, error: 'Cannot modify another customer\'s booking' };
    }
    if (status !== 'cancelled') return { status: 403, error: 'Customers can only cancel bookings' };
    if (!['booked', 'confirmed'].includes(booking.status)) {
      return { status: 400, error: 'Cannot cancel booking in current state' };
    }
    return null;
  }
  return { status: 403, error: 'Invalid account type' };
}

router.get('/shop/bookings/:tailorId', async (req, res) => {
  try {
    if (!validateId(req.params.tailorId)) return res.status(400).json({ error: 'Invalid tailor ID' });
    if (req.query.actorId !== req.params.tailorId) {
      return res.status(403).json({ error: 'Cannot view another tailor\'s bookings' });
    }
    const result = await pool.query(
      'SELECT * FROM bookings WHERE tailor_id = $1 ORDER BY created_at DESC',
      [req.params.tailorId]
    );
    return res.json({ bookings: result.rows });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.put('/shop/bookings/:id/status', async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid booking ID' });
    const { actorId, actorType, status, tailorNotes } = req.body;
    if (!status || !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status value' });
    const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = result.rows[0];
    const denied = actorCanChange(booking, actorId, actorType, status);
    if (denied) return res.status(denied.status).json({ error: denied.error });
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
    await notify(
      booking.customer_id || booking.customer_phone,
      'Booking Updated',
      `Your ${booking.garment_type} booking is now "${status}"`,
      booking.id
    );
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Update failed' });
  }
});

router.put('/shop/bookings/:id/notes', async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid booking ID' });
    const { actorId, actorType, notes } = req.body;
    if (!notes || !safeText(notes, 2000)) return res.status(400).json({ error: 'Notes are required (max 2000 chars)' });
    const result = await pool.query('SELECT notes, tailor_id, customer_id FROM bookings WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = result.rows[0];
    if (actorType === 'tailor') {
      if (actorId !== booking.tailor_id) {
        return res.status(403).json({ error: 'Cannot modify another tailor\'s booking' });
      }
    } else if (actorType === 'user') {
      if (!booking.customer_id || booking.customer_id !== actorId) {
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

router.put('/shop/bookings/:id/payment-status', async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid booking ID' });
    const { actorId, paymentStatus } = req.body;
    if (!paymentStatus || !VALID_PAYMENT_STATUSES.includes(paymentStatus)) {
      return res.status(400).json({ error: 'Invalid payment status' });
    }
    const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = result.rows[0];
    if (actorId !== booking.tailor_id) {
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

module.exports = router;
