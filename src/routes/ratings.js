const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireUser, requireTailor } = require('../middleware/auth');
const { validateId, safeName, safeText } = require('../validate');
const { notify } = require('../notify');

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

router.post('/', authenticateToken, requireUser, async (req, res) => {
  try {
    const { bookingId, tailorId, customerName, garmentType, stars, comment, photoUrl } = req.body || {};
    if (!bookingId || !tailorId || !customerName || !garmentType || stars === undefined) {
      return res.status(400).json({ error: 'Missing required rating fields' });
    }
    if (!validateId(bookingId) || !validateId(tailorId)) return res.status(400).json({ error: 'Invalid ID format' });
    if (!safeName(customerName)) return res.status(400).json({ error: 'Customer name required (1-100 chars)' });
    if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ error: 'Stars must be an integer between 1 and 5' });
    }
    if (comment && !safeText(comment, 1000)) return res.status(400).json({ error: 'Comment must be 1-1000 characters' });
    const bookingCheck = await pool.query('SELECT id, customer_id, tailor_id, status FROM bookings WHERE id = $1', [bookingId]);
    if (bookingCheck.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = bookingCheck.rows[0];
    if (booking.tailor_id !== tailorId) return res.status(400).json({ error: 'Tailor ID does not match booking' });
    if (!booking.customer_id || booking.customer_id !== req.auth.id) {
      return res.status(403).json({ error: 'Cannot rate another customer\'s booking' });
    }
    if (booking.status !== 'completed') return res.status(400).json({ error: 'Can only rate completed bookings' });
    const existing = await pool.query('SELECT id FROM ratings WHERE booking_id = $1', [bookingId]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Rating already exists for this booking' });
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const rating = {
      id,
      booking_id: bookingId,
      tailor_id: tailorId,
      customer_name: customerName.trim(),
      garment_type: garmentType,
      stars,
      comment: comment || null,
      photo_url: photoUrl || null,
      tailor_reply: null,
      created_at: createdAt,
    };
    await pool.query(
      `INSERT INTO ratings (id, booking_id, tailor_id, customer_name, garment_type, stars, comment, photo_url, tailor_reply, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [rating.id, rating.booking_id, rating.tailor_id, rating.customer_name, rating.garment_type, rating.stars, rating.comment, rating.photo_url, rating.tailor_reply, rating.created_at]
    );
    const summary = await pool.query('SELECT AVG(stars) AS avg, COUNT(*) AS cnt FROM ratings WHERE tailor_id = $1', [tailorId]);
    await pool.query('UPDATE tailors SET average_rating = $1, total_ratings = $2 WHERE id = $3', [
      parseFloat(summary.rows[0].avg) || 0,
      parseInt(summary.rows[0].cnt, 10) || 0,
      tailorId,
    ]);
    notify(tailorId, 'New Rating', `${rating.customer_name} gave ${stars} stars`, '');
    return res.json({ rating });
  } catch (e) {
    return res.status(500).json({ error: 'Rating submission failed' });
  }
});

router.put('/:id/reply', authenticateToken, requireTailor, async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid rating ID' });
    const { reply } = req.body || {};
    if (!reply || !safeText(reply, 1000)) return res.status(400).json({ error: 'Reply is required (max 1000 chars)' });
    const existing = await pool.query('SELECT tailor_id FROM ratings WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Rating not found' });
    if (existing.rows[0].tailor_id !== req.auth.id) {
      return res.status(403).json({ error: 'Cannot reply to another tailor\'s rating' });
    }
    await pool.query('UPDATE ratings SET tailor_reply = $1 WHERE id = $2', [reply.trim(), req.params.id]);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Reply failed' });
  }
});

module.exports = router;
