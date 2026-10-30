const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireTailor } = require('../middleware/auth');
const { validateId } = require('../validate');
const {
  parseWorkingHours,
  validateWorkingHours,
  isWorkingDay,
  getWorkingHoursForDay,
  generateTimeSlots,
} = require('../schedule');

const router = express.Router();

router.get('/working-hours', authenticateToken, requireTailor, async (req, res) => {
  try {
    const result = await pool.query('SELECT working_hours, slot_duration FROM tailors WHERE id = $1', [req.auth.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tailor not found' });
    return res.json({
      workingHours: parseWorkingHours(result.rows[0].working_hours),
      slotDuration: result.rows[0].slot_duration || 60,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.put('/working-hours', authenticateToken, requireTailor, async (req, res) => {
  try {
    const { workingHours, slotDuration } = req.body;
    if (!validateWorkingHours(workingHours)) return res.status(400).json({ error: 'Invalid working hours format' });
    const duration = parseInt(slotDuration, 10) || 60;
    if (duration < 15 || duration > 480) return res.status(400).json({ error: 'Slot duration must be 15-480 minutes' });
    await pool.query(
      'UPDATE tailors SET working_hours = $1, slot_duration = $2 WHERE id = $3',
      [JSON.stringify(workingHours), duration, req.auth.id]
    );
    return res.json({ success: true, workingHours, slotDuration: duration });
  } catch (e) {
    return res.status(500).json({ error: 'Update failed' });
  }
});

router.get('/slots', authenticateToken, requireTailor, async (req, res) => {
  try {
    const { date } = req.query;
    let query = 'SELECT * FROM slots WHERE tailor_id = $1';
    const params = [req.auth.id];
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      query += ' AND date = $2';
      params.push(date);
    }
    query += ' ORDER BY date, time_slot';
    const result = await pool.query(query, params);
    return res.json({ slots: result.rows });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.post('/slots', authenticateToken, requireTailor, async (req, res) => {
  try {
    const { date, timeSlot, maxCustomers } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date format (YYYY-MM-DD)' });
    if (!timeSlot || typeof timeSlot !== 'string') return res.status(400).json({ error: 'Time slot required' });
    const capacity = parseInt(maxCustomers, 10) || 3;
    if (capacity < 1 || capacity > 20) return res.status(400).json({ error: 'Capacity must be 1-20' });
    const tailor = await pool.query('SELECT working_hours, slot_duration FROM tailors WHERE id = $1', [req.auth.id]);
    if (tailor.rows.length === 0) return res.status(404).json({ error: 'Tailor not found' });
    const workingHours = parseWorkingHours(tailor.rows[0].working_hours);
    if (!isWorkingDay(workingHours, date)) return res.status(400).json({ error: 'Not a working day' });
    const dayHours = getWorkingHoursForDay(workingHours, date);
    if (dayHours) {
      const duration = tailor.rows[0].slot_duration || 60;
      const validSlots = generateTimeSlots(dayHours.open, dayHours.close, duration);
      if (!validSlots.includes(timeSlot)) return res.status(400).json({ error: 'Time slot outside working hours' });
    }
    const duplicate = await pool.query(
      'SELECT id FROM slots WHERE tailor_id = $1 AND date = $2 AND time_slot = $3',
      [req.auth.id, date, timeSlot]
    );
    if (duplicate.rows.length > 0) return res.status(409).json({ error: 'Slot already exists' });
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO slots (id, tailor_id, date, time_slot, max_customers, booked_customers, is_blocked) VALUES ($1,$2,$3,$4,$5,0,0)',
      [id, req.auth.id, date, timeSlot, capacity]
    );
    const created = await pool.query('SELECT * FROM slots WHERE id = $1', [id]);
    return res.json({ slot: created.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to create slot' });
  }
});

router.put('/slots/:id', authenticateToken, requireTailor, async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid slot ID' });
    const existing = await pool.query('SELECT * FROM slots WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Slot not found' });
    if (existing.rows[0].tailor_id !== req.auth.id) return res.status(403).json({ error: 'Cannot modify another tailor\'s slot' });
    const { maxCustomers, isBlocked } = req.body;
    const fields = [];
    const values = [];
    let index = 1;
    if (maxCustomers !== undefined) {
      const capacity = parseInt(maxCustomers, 10);
      if (capacity < 1 || capacity > 20) return res.status(400).json({ error: 'Capacity must be 1-20' });
      fields.push(`max_customers=$${index}`); values.push(capacity); index += 1;
    }
    if (isBlocked !== undefined) {
      fields.push(`is_blocked=$${index}`); values.push(isBlocked ? 1 : 0); index += 1;
    }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    values.push(req.params.id);
    await pool.query(`UPDATE slots SET ${fields.join(',')} WHERE id=$${index}`, values);
    const updated = await pool.query('SELECT * FROM slots WHERE id = $1', [req.params.id]);
    return res.json({ slot: updated.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Update failed' });
  }
});

router.delete('/slots/:id', authenticateToken, requireTailor, async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid slot ID' });
    const existing = await pool.query('SELECT * FROM slots WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Slot not found' });
    if (existing.rows[0].tailor_id !== req.auth.id) return res.status(403).json({ error: 'Cannot delete another tailor\'s slot' });
    if (existing.rows[0].booked_customers > 0) {
      return res.status(409).json({ error: 'Cannot delete slot with existing bookings. Block it instead.' });
    }
    await pool.query('DELETE FROM slots WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;
