const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireUser } = require('../middleware/auth');
const { validateId } = require('../validate');

const router = express.Router();

function favoriteList(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
  return [];
}

router.get('/favorites', authenticateToken, requireUser, async (req, res) => {
  try {
    const result = await pool.query('SELECT favorites FROM users WHERE id = $1', [req.auth.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    return res.json({ favorites: favoriteList(result.rows[0].favorites) });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.post('/favorites', authenticateToken, requireUser, async (req, res) => {
  try {
    const { tailorId } = req.body || {};
    if (!tailorId || !validateId(tailorId)) return res.status(400).json({ error: 'Invalid tailor ID' });
    const shop = await pool.query('SELECT id FROM tailors WHERE id = $1 AND is_active = 1', [tailorId]);
    if (shop.rows.length === 0) return res.status(404).json({ error: 'Shop not found' });
    const user = await pool.query('SELECT favorites FROM users WHERE id = $1', [req.auth.id]);
    if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const favorites = favoriteList(user.rows[0].favorites);
    if (!favorites.includes(tailorId)) favorites.push(tailorId);
    await pool.query('UPDATE users SET favorites = $1::jsonb WHERE id = $2', [JSON.stringify(favorites), req.auth.id]);
    return res.json({ success: true, favorites });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.delete('/favorites/:tailorId', authenticateToken, requireUser, async (req, res) => {
  try {
    if (!validateId(req.params.tailorId)) return res.status(400).json({ error: 'Invalid tailor ID' });
    const user = await pool.query('SELECT favorites FROM users WHERE id = $1', [req.auth.id]);
    if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const favorites = favoriteList(user.rows[0].favorites).filter((id) => id !== req.params.tailorId);
    await pool.query('UPDATE users SET favorites = $1::jsonb WHERE id = $2', [JSON.stringify(favorites), req.auth.id]);
    return res.json({ success: true, favorites });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
