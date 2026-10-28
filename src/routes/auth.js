const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { jwtSecret, jwtExpiry } = require('../config');
const { rateLimit } = require('../middleware/rateLimit');
const { validateEmail, validatePhone, validatePassword, safeName } = require('../validate');

const router = express.Router();
const authRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

function signToken(id, email, type) {
  return jwt.sign({ id, email, type }, jwtSecret, { expiresIn: jwtExpiry });
}

router.post('/register/user', authRateLimit, async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Required fields missing' });
    if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid email format' });
    if (!validatePassword(password)) return res.status(400).json({ error: 'Password must be 6-128 characters' });
    if (!safeName(name)) return res.status(400).json({ error: 'Invalid name' });
    if (phone && !validatePhone(phone)) return res.status(400).json({ error: 'Invalid phone number' });
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });
    const id = crypto.randomUUID();
    const hashed = bcrypt.hashSync(password, 10);
    const referralCode = crypto.randomUUID().slice(0, 8).toUpperCase();
    await pool.query(
      'INSERT INTO users (id, name, phone, email, password, referralcode, referredusers, favorites) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, name.trim(), phone || '', email.toLowerCase(), hashed, referralCode, JSON.stringify([]), JSON.stringify([])]
    );
    const token = signToken(id, email.toLowerCase(), 'user');
    return res.json({
      token,
      user: {
        id,
        name: name.trim(),
        phone: phone || '',
        email: email.toLowerCase(),
        referral_code: referralCode,
        referred_users: [],
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/register/tailor', authRateLimit, async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Required fields missing' });
    if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid email format' });
    if (!validatePassword(password)) return res.status(400).json({ error: 'Password must be 6-128 characters' });
    if (!safeName(name)) return res.status(400).json({ error: 'Invalid name' });
    if (phone && !validatePhone(phone)) return res.status(400).json({ error: 'Invalid phone number' });
    const existing = await pool.query('SELECT id FROM tailors WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });
    const id = `tailor_${crypto.randomUUID().slice(0, 8)}`;
    const hashed = bcrypt.hashSync(password, 10);
    const shopDescription = req.body.shopDescription || '';
    const address = req.body.address || '';
    const latitude = req.body.latitude || 0;
    const longitude = req.body.longitude || 0;
    const shopType = req.body.shopType || 'tailor';
    await pool.query(
      `INSERT INTO tailors (
        id, name, phone, email, password, shop_description, address, latitude, longitude,
        stitching_days, garment_types, prices, item_prices, estimated_hours, shop_type, portfolio_images
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        id, name.trim(), phone || '', email.toLowerCase(), hashed, shopDescription, address, latitude, longitude,
        JSON.stringify(req.body.stitchingDays || {}),
        JSON.stringify(req.body.garmentTypes || []),
        JSON.stringify(req.body.prices || {}),
        JSON.stringify(req.body.itemPrices || {}),
        req.body.estimatedHours || 2,
        shopType,
        '[]',
      ]
    );
    const token = signToken(id, email.toLowerCase(), 'tailor');
    return res.json({
      token,
      tailor: {
        id,
        name: name.trim(),
        phone: phone || '',
        email: email.toLowerCase(),
        shop_description: shopDescription,
        address,
        latitude,
        longitude,
        average_rating: 0,
        total_ratings: 0,
        shop_type: shopType,
        is_active: 1,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login/user', authRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid email format' });
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = result.rows[0];
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = signToken(user.id, user.email, 'user');
    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        referral_code: user.referralcode,
        referred_users: user.referredusers || [],
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/login/tailor', authRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid email format' });
    const result = await pool.query('SELECT * FROM tailors WHERE email = $1', [email.toLowerCase()]);
    const tailor = result.rows[0];
    if (!tailor || !bcrypt.compareSync(password, tailor.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = signToken(tailor.id, tailor.email, 'tailor');
    return res.json({
      token,
      tailor: {
        id: tailor.id,
        name: tailor.name,
        phone: tailor.phone,
        email: tailor.email,
        shop_description: tailor.shop_description,
        address: tailor.address,
        latitude: tailor.latitude,
        longitude: tailor.longitude,
        average_rating: tailor.average_rating,
        total_ratings: tailor.total_ratings,
        shop_type: tailor.shop_type,
        is_active: tailor.is_active,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/user/:email', (req, res) => {
  if (!validateEmail(req.params.email)) return res.status(400).json({ error: 'Invalid email' });
  return pool.query('SELECT id FROM users WHERE email = $1', [req.params.email.toLowerCase()])
    .then((result) => res.json({ exists: result.rows.length > 0 }))
    .catch(() => res.status(500).json({ error: 'Database error' }));
});

router.get('/phone/:phone', (req, res) => {
  if (!validatePhone(req.params.phone)) return res.status(400).json({ error: 'Invalid phone' });
  return pool.query('SELECT id FROM users WHERE phone = $1', [req.params.phone])
    .then((result) => res.json({ exists: result.rows.length > 0 }))
    .catch(() => res.status(500).json({ error: 'Database error' }));
});

module.exports = router;
