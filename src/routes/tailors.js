const express = require('express');
const { pool } = require('../db');
const { validateId } = require('../validate');

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
