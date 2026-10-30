const express = require('express');
const { pool } = require('../db');
const { validateId } = require('../validate');
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
