const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireTailor } = require('../middleware/auth');
const { validateId, validatePhone } = require('../validate');
const { parseWorkingHours, isWorkingDay, getWorkingHoursForDay, generateTimeSlots } = require('../schedule');

const router = express.Router();

const PUBLIC_COLUMNS = `
  id, name, phone, email, shop_description, address, latitude, longitude,
  average_rating, total_ratings, stitching_days, garment_types, prices, item_prices,
  estimated_hours, shop_type, portfolio_images, is_active, offers_pickup_drop,
  pickup_radius_km, base_delivery_charge, profile_image_url
`;

router.get('/', async (req, res) => {
  try {
    const { type } = req.query;
    let query = `SELECT ${PUBLIC_COLUMNS} FROM tailors WHERE is_active = 1`;
    const params = [];
    if (type && ['tailor', 'iron'].includes(type)) {
      query += ' AND shop_type = $1';
      params.push(type);
    }
    const result = await pool.query(query, params);
    return res.json({ tailors: result.rows });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.get('/:id/availability', async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid tailor ID' });
    const { date } = req.query;
    if (!date || typeof date !== 'string') return res.status(400).json({ error: 'Date query parameter required (YYYY-MM-DD)' });
    const dateStr = date.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ error: 'Invalid date format' });
    const tailorCheck = await pool.query('SELECT id, working_hours, slot_duration FROM tailors WHERE id = $1', [req.params.id]);
    if (tailorCheck.rows.length === 0) return res.status(404).json({ error: 'Tailor not found' });
    const tailor = tailorCheck.rows[0];
    const workingHours = parseWorkingHours(tailor.working_hours);
    if (!isWorkingDay(workingHours, dateStr)) {
      return res.json({ date: dateStr, tailorId: req.params.id, slots: [], closed: true });
    }
    const dayHours = getWorkingHoursForDay(workingHours, dateStr);
    const duration = tailor.slot_duration || 60;
    const generatedSlots = (dayHours && dayHours.enabled)
      ? generateTimeSlots(dayHours.open, dayHours.close, duration)
      : ['10:00 AM', '11:30 AM', '2:00 PM', '4:00 PM', '5:30 PM'];
    const result = await pool.query(
      'SELECT time_slot, max_customers, booked_customers, is_blocked FROM slots WHERE tailor_id = $1 AND date = $2',
      [req.params.id, dateStr]
    );
    const existingSlots = new Map(result.rows.map((row) => [row.time_slot, row]));
    const hasFullDayBlock = result.rows.some((row) => row.is_blocked && row.time_slot === '10:00 AM' && row.booked_customers === 0);
    const availability = generatedSlots.map((slot) => {
      const existing = existingSlots.get(slot);
      if (existing) {
        return {
          slot,
          available: !existing.is_blocked && existing.booked_customers < existing.max_customers,
          remaining: Math.max(0, existing.max_customers - existing.booked_customers),
          blocked: !!existing.is_blocked,
        };
      }
      if (hasFullDayBlock) return { slot, available: false, remaining: 0, blocked: true };
      return { slot, available: true, remaining: 3, blocked: false };
    });
    return res.json({ date: dateStr, tailorId: req.params.id, slots: availability, closed: false });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.get('/:id/stitching-speeds', (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid tailor ID' });
  return pool.query('SELECT shop_type FROM tailors WHERE id = $1', [req.params.id])
    .then((shop) => {
      if (shop.rows.length === 0 || shop.rows[0].shop_type !== 'tailor') return res.json({ speeds: [] });
      return pool.query(
        'SELECT * FROM tailor_stitching_speeds WHERE tailor_id = $1 AND is_enabled = 1 ORDER BY display_order, turnaround_days',
        [req.params.id]
      ).then((result) => res.json({ speeds: result.rows }));
    })
    .catch(() => res.status(500).json({ error: 'Database error' }));
});

router.get('/:id/ironing-services', (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid tailor ID' });
  return pool.query('SELECT shop_type FROM tailors WHERE id = $1', [req.params.id])
    .then((shop) => {
      if (shop.rows.length === 0 || shop.rows[0].shop_type !== 'iron') return res.json({ services: [] });
      return pool.query(
        'SELECT * FROM ironing_service_types WHERE tailor_id = $1 AND is_enabled = 1 ORDER BY display_order, name',
        [req.params.id]
      ).then((result) => res.json({ services: result.rows }));
    })
    .catch(() => res.status(500).json({ error: 'Database error' }));
});

router.put('/:id', authenticateToken, requireTailor, async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid tailor ID' });
    if (req.auth.id !== req.params.id) return res.status(403).json({ error: 'Cannot modify another tailor\'s profile' });
    const allowed = ['name', 'phone', 'shopDescription', 'address', 'latitude', 'longitude', 'stitchingDays', 'garmentTypes', 'prices', 'itemPrices', 'estimatedHours', 'shopType', 'portfolioImages', 'offersPickupDrop', 'pickupRadiusKm', 'baseDeliveryCharge'];
    const fields = [];
    const values = [];
    let index = 1;
    for (const [key, raw] of Object.entries(req.body || {})) {
      if (key === 'password' || key === 'id' || key === 'email') continue;
      if (!allowed.includes(key)) continue;
      const column = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      let value = typeof raw === 'object' && raw !== null ? JSON.stringify(raw) : raw;
      if (key === 'phone' && !validatePhone(String(raw))) return res.status(400).json({ error: 'Invalid phone' });
      if (key === 'shopType' && raw !== 'tailor' && raw !== 'iron') return res.status(400).json({ error: 'Shop type must be tailor or iron' });
      if (key === 'offersPickupDrop') value = raw ? 1 : 0;
      if (key === 'pickupRadiusKm') {
        const radius = Number(raw);
        if (!Number.isFinite(radius) || radius < 0 || radius > 100) return res.status(400).json({ error: 'Pickup radius must be 0-100 km' });
        value = radius;
      }
      if (key === 'baseDeliveryCharge') {
        const charge = Number(raw);
        if (!Number.isFinite(charge) || charge < 0 || charge > 100000) return res.status(400).json({ error: 'Delivery charge must be 0-100000' });
        value = charge;
      }
      fields.push(`${column}=$${index}`);
      values.push(value);
      index += 1;
    }
    if (fields.length === 0) return res.status(400).json({ error: 'No valid fields to update' });
    values.push(req.params.id);
    await pool.query(`UPDATE tailors SET ${fields.join(',')} WHERE id=$${index}`, values);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Update failed' });
  }
});

router.get('/:id', (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid tailor ID' });
  return pool.query(`SELECT ${PUBLIC_COLUMNS} FROM tailors WHERE id = $1`, [req.params.id])
    .then((result) => {
      if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      return res.json({ tailor: result.rows[0] });
    })
    .catch(() => res.status(500).json({ error: 'Database error' }));
});

module.exports = router;
