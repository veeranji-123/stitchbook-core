const express = require('express');
const { pool } = require('../db');
const { validateId } = require('../validate');

const router = express.Router();

router.get('/booking/:bookingId', (req, res) => {
  if (!validateId(req.params.bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });
  return pool.query('SELECT * FROM ratings WHERE booking_id = $1', [req.params.bookingId])
    .then((result) => res.json({ rating: result.rows[0] || null }))
    .catch(() => res.status(500).json({ error: 'Database error' }));
});

router.get('/:tailorId', (req, res) => {
  if (!validateId(req.params.tailorId)) return res.status(400).json({ error: 'Invalid tailor ID' });
  return pool.query('SELECT * FROM ratings WHERE tailor_id = $1 ORDER BY created_at DESC', [req.params.tailorId])
    .then((result) => res.json({ ratings: result.rows }))
    .catch(() => res.status(500).json({ error: 'Database error' }));
});

module.exports = router;
