const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireTailor } = require('../middleware/auth');
const { validateId } = require('../validate');

const router = express.Router();

function ownShop(req, res) {
  if (!validateId(req.params.tailorId)) {
    res.status(400).json({ error: 'Invalid tailor ID' });
    return false;
  }
  if (req.auth.type !== 'tailor') {
    res.status(403).json({ error: 'Analytics access restricted to tailors' });
    return false;
  }
  if (req.auth.id !== req.params.tailorId) {
    res.status(403).json({ error: 'Cannot view another tailor\'s analytics' });
    return false;
  }
  return true;
}

router.get('/:tailorId/weekly', authenticateToken, requireTailor, async (req, res) => {
  try {
    if (!ownShop(req, res)) return;
    const result = await pool.query(
      'SELECT slot_date FROM bookings WHERE tailor_id = $1 AND slot_date IS NOT NULL',
      [req.params.tailorId]
    );
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weekData = days.map((day, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      const dateStr = date.toISOString().slice(0, 10);
      const count = result.rows.filter((row) => row.slot_date && String(row.slot_date).startsWith(dateStr)).length;
      return { day, count };
    });
    return res.json(weekData);
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.get('/:tailorId/services', authenticateToken, requireTailor, async (req, res) => {
  try {
    if (!ownShop(req, res)) return;
    const result = await pool.query('SELECT garment_type FROM bookings WHERE tailor_id = $1', [req.params.tailorId]);
    const counts = {};
    result.rows.forEach((row) => {
      counts[row.garment_type] = (counts[row.garment_type] || 0) + 1;
    });
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return res.json(Object.entries(counts).map(([name, count]) => ({
      name,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    })));
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.get('/:tailorId/monthly', authenticateToken, requireTailor, async (req, res) => {
  try {
    if (!ownShop(req, res)) return;
    const result = await pool.query('SELECT slot_date FROM bookings WHERE tailor_id = $1', [req.params.tailorId]);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const data = [];
    for (let i = 4; i >= 0; i -= 1) {
      const monthIndex = (now.getMonth() - i + 12) % 12;
      const year = now.getFullYear() - (now.getMonth() - i < 0 ? 1 : 0);
      const count = result.rows.filter((row) => {
        if (!row.slot_date) return false;
        const date = new Date(row.slot_date);
        return date.getMonth() === monthIndex && date.getFullYear() === year;
      }).length;
      data.push({ month: months[monthIndex], bookings: count });
    }
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
