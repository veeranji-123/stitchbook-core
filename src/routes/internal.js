const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { validateId } = require('../validate');
const { VALID_PAYMENT_STATUSES, isValidPaymentTransition } = require('../bookingRules');

const router = express.Router();

function requireInternal(req, res, next) {
  const expected = process.env.INTERNAL_TOKEN;
  const provided = req.headers['x-internal-token'];
  if (!expected || typeof provided !== 'string') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

router.use(requireInternal);

router.get('/bookings/by-order/:orderId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM bookings WHERE razorpay_order_id = $1', [req.params.orderId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    return res.json({ booking: result.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.get('/bookings/by-payment/:paymentId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM bookings WHERE razorpay_payment_id = $1', [req.params.paymentId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    return res.json({ booking: result.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.get('/bookings/:id', async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid booking ID' });
    const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    return res.json({ booking: result.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

router.patch('/bookings/:id/payment', async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid booking ID' });
    const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = result.rows[0];
    const { paymentStatus, razorpayOrderId, razorpayPaymentId } = req.body;

    if (paymentStatus !== undefined) {
      if (!VALID_PAYMENT_STATUSES.includes(paymentStatus)) {
        return res.status(400).json({ error: 'Invalid payment status' });
      }
      if (paymentStatus !== booking.payment_status && !isValidPaymentTransition(booking.payment_status, paymentStatus)) {
        return res.status(409).json({
          error: 'Invalid payment transition',
          current: booking.payment_status,
        });
      }
    }

    await pool.query(
      `UPDATE bookings
       SET payment_status = COALESCE($1, payment_status),
           razorpay_order_id = COALESCE($2, razorpay_order_id),
           razorpay_payment_id = COALESCE($3, razorpay_payment_id),
           updated_at = $4
       WHERE id = $5`,
      [
        paymentStatus || null,
        razorpayOrderId || null,
        razorpayPaymentId || null,
        new Date().toISOString(),
        req.params.id,
      ]
    );
    const updated = await pool.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    return res.json({ booking: updated.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Update failed' });
  }
});

module.exports = router;
