const express = require('express');
const { pool } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ service: 'stitchbook-core', status: 'ok' });
});

router.get('/api/health', async (req, res) => {
  try {
    const [users, tailors, bookings] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM tailors'),
      pool.query('SELECT COUNT(*) FROM bookings'),
    ]);
    res.json({
      service: 'stitchbook-core',
      status: 'ok',
      uptime: process.uptime(),
      users: parseInt(users.rows[0].count, 10),
      tailors: parseInt(tailors.rows[0].count, 10),
      bookings: parseInt(bookings.rows[0].count, 10),
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
