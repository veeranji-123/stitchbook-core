const express = require('express');
const { pool } = require('../db');
const { validateId } = require('../validate');

const router = express.Router();

router.get('/:tailorId', (req, res) => {
  if (!validateId(req.params.tailorId)) return res.status(400).json({ error: 'Invalid tailor ID' });
  return pool.query('SELECT * FROM slots WHERE tailor_id = $1', [req.params.tailorId])
    .then((result) => res.json({ slots: result.rows }))
    .catch(() => res.status(500).json({ error: 'Database error' }));
});

module.exports = router;
