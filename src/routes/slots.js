const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireTailor } = require('../middleware/auth');
const { validateId } = require('../validate');

const router = express.Router();

router.post('/block', authenticateToken, requireTailor, async (req, res) => {
  try {
    const { tailorId, date } = req.body;
    if (!tailorId || !date) return res.status(400).json({ error: 'tailorId and date required' });
    if (!validateId(tailorId)) return res.status(400).json({ error: 'Invalid tailor ID' });
    if (req.auth.id !== tailorId) return res.status(403).json({ error: 'Cannot modify another tailor\'s slots' });
    const dateStr = typeof date === 'string' ? date.slice(0, 10) : new Date(date).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ error: 'Invalid date format' });
    const existing = await pool.query('SELECT id FROM slots WHERE tailor_id = $1 AND date = $2', [tailorId, dateStr]);
    if (existing.rows.length > 0) {
      await pool.query('UPDATE slots SET is_blocked = 1 WHERE id = $1', [existing.rows[0].id]);
    } else {
      await pool.query(
        'INSERT INTO slots (id, tailor_id, date, max_customers, booked_customers, is_blocked) VALUES ($1,$2,$3,$4,$5,$6)',
        [crypto.randomUUID(), tailorId, dateStr, 3, 0, 1]
      );
    }
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Operation failed' });
  }
});

router.get('/:tailorId', (req, res) => {
  if (!validateId(req.params.tailorId)) return res.status(400).json({ error: 'Invalid tailor ID' });
  return pool.query('SELECT * FROM slots WHERE tailor_id = $1', [req.params.tailorId])
    .then((result) => res.json({ slots: result.rows }))
    .catch(() => res.status(500).json({ error: 'Database error' }));
});

module.exports = router;
