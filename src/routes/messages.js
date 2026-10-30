const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { validateId, safeText } = require('../validate');
const { notify } = require('../notify');

const router = express.Router();

async function participant(bookingId, auth) {
  const result = await pool.query('SELECT customer_id, tailor_id FROM bookings WHERE id = $1', [bookingId]);
  if (result.rows.length === 0) return { allowed: false, status: 404, error: 'Booking not found' };
  const booking = result.rows[0];
  if (auth.type === 'tailor' && auth.id === booking.tailor_id) return { allowed: true, booking };
  if (auth.type === 'user' && booking.customer_id === auth.id) return { allowed: true, booking };
  if (auth.type === 'tailor') return { allowed: false, status: 403, error: 'Cannot access messages for another tailor\'s booking' };
  if (auth.type === 'user') return { allowed: false, status: 403, error: 'Cannot access messages for another customer\'s booking' };
  return { allowed: false, status: 403, error: 'Invalid account type' };
}

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { bookingId, receiverId, text } = req.body || {};
    if (!bookingId || !receiverId || !text) return res.status(400).json({ error: 'Missing fields' });
    if (!validateId(bookingId) || !validateId(receiverId)) return res.status(400).json({ error: 'Invalid ID format' });
    if (!safeText(text, 2000)) return res.status(400).json({ error: 'Message text required (max 2000 chars)' });
    const check = await participant(bookingId, req.auth);
    if (!check.allowed) return res.status(check.status).json({ error: check.error });
    const otherId = req.auth.type === 'tailor' ? check.booking.customer_id : check.booking.tailor_id;
    if (receiverId !== otherId) return res.status(400).json({ error: 'Receiver is not part of this booking' });
    const message = {
      id: crypto.randomUUID(),
      booking_id: bookingId,
      sender_id: req.auth.id,
      sender_type: req.auth.type,
      receiver_id: receiverId,
      text: text.trim(),
      created_at: new Date().toISOString(),
    };
    await pool.query(
      'INSERT INTO messages (id, booking_id, sender_id, sender_type, receiver_id, text, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [message.id, message.booking_id, message.sender_id, message.sender_type, message.receiver_id, message.text, message.created_at]
    );
    const label = req.auth.type === 'tailor' ? 'Tailor' : 'Customer';
    notify(receiverId, `New message from ${label}`, message.text, bookingId);
    notify.emit(receiverId, 'message', message);
    notify.emit(req.auth.id, 'message', message);
    return res.json({ message });
  } catch (e) {
    return res.status(500).json({ error: 'Message send failed' });
  }
});

router.get('/:bookingId', authenticateToken, async (req, res) => {
  try {
    if (!validateId(req.params.bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });
    const check = await participant(req.params.bookingId, req.auth);
    if (!check.allowed) return res.status(check.status).json({ error: check.error });
    const result = await pool.query('SELECT * FROM messages WHERE booking_id = $1 ORDER BY created_at ASC', [req.params.bookingId]);
    return res.json({ messages: result.rows });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
