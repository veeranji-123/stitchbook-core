const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireUser, requireTailor } = require('../middleware/auth');
const { validateId, safeName } = require('../validate');

const VALID_UNITS = ['cm', 'inches'];
const VALID_GARMENT_TYPES = ['general', 'shirt', 'pant', 'tshirt', 'trouser', 'suit', 'blouse', 'kurta', 'lehenga', 'gown', 'jacket', 'dress', 'salwar', 'iron'];
const MAX_MEASUREMENT_FIELDS = 20;

function simpleMeasurements(body) {
  const measurements = {};
  for (const key of ['chest', 'waist', 'hips', 'length', 'shoulders', 'sleeves', 'inseam']) {
    if (body[key] !== undefined) measurements[key] = Number(body[key]) || 0;
  }
  if (body.notes !== undefined) measurements.notes = String(body.notes).slice(0, 500);
  return measurements;
}

function validateMeasurementsJson(measurements) {
  if (!measurements || typeof measurements !== 'object' || Array.isArray(measurements)) return false;
  const keys = Object.keys(measurements);
  if (keys.length > MAX_MEASUREMENT_FIELDS) return false;
  for (const key of keys) {
    if (typeof key !== 'string' || key.length > 50) return false;
    const value = measurements[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 500) return false;
  }
  return true;
}

function validateBookingMeasurements(measurements) {
  if (!measurements || typeof measurements !== 'object' || Array.isArray(measurements)) {
    return { valid: false, error: 'Measurements must be an object' };
  }
  const keys = Object.keys(measurements);
  if (keys.length > MAX_MEASUREMENT_FIELDS) {
    return { valid: false, error: `Too many fields (max ${MAX_MEASUREMENT_FIELDS})` };
  }
  for (const key of keys) {
    if (typeof key !== 'string' || key.length > 50) return { valid: false, error: 'Invalid field name' };
    const value = measurements[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 500) {
      return { valid: false, error: `Invalid value for ${key}` };
    }
  }
  return { valid: true };
}

async function bookingAccess(bookingId, auth) {
  const result = await pool.query('SELECT id, tailor_id, customer_id FROM bookings WHERE id = $1', [bookingId]);
  if (result.rows.length === 0) return { status: 404, error: 'Booking not found' };
  const booking = result.rows[0];
  if (auth.type === 'user' && booking.customer_id === auth.id) return { booking };
  if (auth.type === 'tailor' && booking.tailor_id === auth.id) return { booking };
  return { status: 403, error: 'Access denied' };
}

const userRouter = express.Router();

userRouter.get('/measurements', authenticateToken, requireUser, async (req, res) => {
  try {
    const result = await pool.query('SELECT measurements FROM users WHERE id = $1', [req.auth.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    return res.json({ measurements: result.rows[0].measurements || null });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

userRouter.put('/measurements', authenticateToken, requireUser, async (req, res) => {
  try {
    const measurements = simpleMeasurements(req.body || {});
    const result = await pool.query(
      'UPDATE users SET measurements = $1 WHERE id = $2 RETURNING measurements',
      [JSON.stringify(measurements), req.auth.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    return res.json({ success: true, measurements: result.rows[0].measurements });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

const profileRouter = express.Router();

profileRouter.get('/', authenticateToken, requireUser, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM measurement_profiles WHERE user_id = $1 ORDER BY created_at DESC',
      [req.auth.id]
    );
    return res.json({ profiles: result.rows });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

profileRouter.post('/', authenticateToken, requireUser, async (req, res) => {
  try {
    const { name, garmentType, unit, measurements } = req.body || {};
    if (!name || !safeName(name)) return res.status(400).json({ error: 'Profile name required (1-100 chars)' });
    if (unit && !VALID_UNITS.includes(unit)) return res.status(400).json({ error: 'Unit must be cm or inches' });
    if (garmentType && !VALID_GARMENT_TYPES.includes(garmentType)) return res.status(400).json({ error: 'Invalid garment type' });
    if (measurements && !validateMeasurementsJson(measurements)) {
      return res.status(400).json({ error: 'Invalid measurements: keys max 50 chars, values must be numbers 0-500' });
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await pool.query(
      `INSERT INTO measurement_profiles (id, user_id, name, garment_type, unit, measurements, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, req.auth.id, name.trim(), garmentType || 'general', unit || 'cm', JSON.stringify(measurements || {}), now, now]
    );
    const created = await pool.query('SELECT * FROM measurement_profiles WHERE id = $1', [id]);
    return res.json({ profile: created.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to create profile' });
  }
});

profileRouter.get('/:id', authenticateToken, requireUser, async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid profile ID' });
    const result = await pool.query('SELECT * FROM measurement_profiles WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Profile not found' });
    if (result.rows[0].user_id !== req.auth.id) return res.status(403).json({ error: 'Access denied' });
    return res.json({ profile: result.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

profileRouter.put('/:id', authenticateToken, requireUser, async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid profile ID' });
    const existing = await pool.query('SELECT user_id FROM measurement_profiles WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Profile not found' });
    if (existing.rows[0].user_id !== req.auth.id) return res.status(403).json({ error: 'Access denied' });
    const { name, garmentType, unit, measurements } = req.body || {};
    if (name !== undefined && !safeName(name)) return res.status(400).json({ error: 'Invalid profile name' });
    if (unit !== undefined && !VALID_UNITS.includes(unit)) return res.status(400).json({ error: 'Unit must be cm or inches' });
    if (garmentType !== undefined && !VALID_GARMENT_TYPES.includes(garmentType)) return res.status(400).json({ error: 'Invalid garment type' });
    if (measurements !== undefined && !validateMeasurementsJson(measurements)) return res.status(400).json({ error: 'Invalid measurements' });
    const updates = [];
    const values = [];
    let index = 1;
    if (name !== undefined) { updates.push(`name=$${index}`); values.push(name.trim()); index += 1; }
    if (garmentType !== undefined) { updates.push(`garment_type=$${index}`); values.push(garmentType); index += 1; }
    if (unit !== undefined) { updates.push(`unit=$${index}`); values.push(unit); index += 1; }
    if (measurements !== undefined) { updates.push(`measurements=$${index}`); values.push(JSON.stringify(measurements)); index += 1; }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    updates.push(`updated_at=$${index}`);
    values.push(new Date().toISOString());
    index += 1;
    values.push(req.params.id);
    await pool.query(`UPDATE measurement_profiles SET ${updates.join(', ')} WHERE id=$${index}`, values);
    const updated = await pool.query('SELECT * FROM measurement_profiles WHERE id = $1', [req.params.id]);
    return res.json({ profile: updated.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Update failed' });
  }
});

profileRouter.delete('/:id', authenticateToken, requireUser, async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid profile ID' });
    const existing = await pool.query('SELECT user_id FROM measurement_profiles WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Profile not found' });
    if (existing.rows[0].user_id !== req.auth.id) return res.status(403).json({ error: 'Access denied' });
    await pool.query('DELETE FROM measurement_profiles WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Delete failed' });
  }
});

const bookingRouter = express.Router();

bookingRouter.get('/measurements', authenticateToken, async (req, res) => {
  try {
    const { ids } = req.query;
    if (!ids || typeof ids !== 'string') {
      return res.status(400).json({ error: 'ids query parameter required (comma-separated booking IDs)' });
    }
    const bookingIds = ids.split(',').map((id) => id.trim()).filter((id) => validateId(id));
    if (bookingIds.length === 0) return res.json({ measurements: {} });
    if (bookingIds.length > 50) return res.status(400).json({ error: 'Maximum 50 booking IDs allowed per request' });
    const placeholders = bookingIds.map((_, i) => `$${i + 1}`).join(',');
    const bookingCheck = await pool.query(
      `SELECT id, customer_id, tailor_id FROM bookings WHERE id IN (${placeholders})`,
      bookingIds
    );
    if (bookingCheck.rows.length !== bookingIds.length) {
      return res.status(404).json({ error: 'One or more bookings not found' });
    }
    for (const booking of bookingCheck.rows) {
      const allowed = (req.auth.type === 'user' && booking.customer_id === req.auth.id)
        || (req.auth.type === 'tailor' && booking.tailor_id === req.auth.id);
      if (!allowed) return res.status(403).json({ error: 'Access denied to one or more bookings' });
    }
    const result = await pool.query(
      `SELECT * FROM booking_measurements WHERE booking_id IN (${placeholders}) ORDER BY booking_id, created_at DESC`,
      bookingIds
    );
    const grouped = {};
    for (const row of result.rows) {
      if (!grouped[row.booking_id]) grouped[row.booking_id] = [];
      grouped[row.booking_id].push(row);
    }
    return res.json({ measurements: grouped });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

bookingRouter.get('/:bookingId/measurements', authenticateToken, async (req, res) => {
  try {
    if (!validateId(req.params.bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });
    const access = await bookingAccess(req.params.bookingId, req.auth);
    if (access.error) return res.status(access.status).json({ error: access.error });
    const result = await pool.query(
      'SELECT * FROM booking_measurements WHERE booking_id = $1 ORDER BY created_at DESC',
      [req.params.bookingId]
    );
    return res.json({ measurements: result.rows });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

bookingRouter.post('/:bookingId/measurements', authenticateToken, requireUser, async (req, res) => {
  try {
    if (!validateId(req.params.bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });
    const { measurements, unit, garmentType } = req.body || {};
    const validUnit = VALID_UNITS.includes(unit) ? unit : 'cm';
    const validGarment = VALID_GARMENT_TYPES.includes(garmentType) ? garmentType : 'general';
    const validation = validateBookingMeasurements(measurements);
    if (!validation.valid) return res.status(400).json({ error: validation.error });
    const access = await bookingAccess(req.params.bookingId, req.auth);
    if (access.error) return res.status(access.status).json({ error: access.error });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const result = await pool.query(
      `INSERT INTO booking_measurements (id, booking_id, user_id, tailor_id, garment_type, unit, measurements, source, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'customer',$8,$8)
       ON CONFLICT (booking_id, user_id) WHERE source = 'customer'
       DO UPDATE SET measurements = EXCLUDED.measurements, unit = EXCLUDED.unit, garment_type = EXCLUDED.garment_type, updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [id, req.params.bookingId, req.auth.id, access.booking.tailor_id, validGarment, validUnit, JSON.stringify(measurements), now]
    );
    return res.json({ measurement: result.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

bookingRouter.put('/:bookingId/measurements', authenticateToken, requireTailor, async (req, res) => {
  try {
    if (!validateId(req.params.bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });
    const { measurements, unit, garmentType } = req.body || {};
    const validUnit = VALID_UNITS.includes(unit) ? unit : 'cm';
    const validGarment = VALID_GARMENT_TYPES.includes(garmentType) ? garmentType : 'general';
    const validation = validateBookingMeasurements(measurements);
    if (!validation.valid) return res.status(400).json({ error: validation.error });
    const access = await bookingAccess(req.params.bookingId, req.auth);
    if (access.error) return res.status(access.status).json({ error: access.error });
    if (!access.booking.customer_id) return res.status(400).json({ error: 'Booking has no customer' });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const result = await pool.query(
      `INSERT INTO booking_measurements (id, booking_id, user_id, tailor_id, garment_type, unit, measurements, source, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'tailor_confirmed',$8,$8)
       ON CONFLICT (booking_id, tailor_id) WHERE source = 'tailor_confirmed'
       DO UPDATE SET measurements = EXCLUDED.measurements, unit = EXCLUDED.unit, garment_type = EXCLUDED.garment_type, updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [id, req.params.bookingId, access.booking.customer_id, req.auth.id, validGarment, validUnit, JSON.stringify(measurements), now]
    );
    return res.json({ measurement: result.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

module.exports = { userRouter, profileRouter, bookingRouter };
