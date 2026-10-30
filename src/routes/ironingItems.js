const crypto = require('crypto');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { validateId } = require('../validate');
const { uploadsDir, ensureUploadsDir, looksLikeImageFile, safeExtension, removeFile, PHOTO_EXTENSIONS } = require('../files');

ensureUploadsDir();
const MAX_PHOTOS_PER_IRONING_ITEM = 3;

const photoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      cb(null, `iron_${crypto.randomUUID().slice(0, 12)}_${Date.now()}${safeExtension(file.originalname)}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!PHOTO_EXTENSIONS.includes(ext)) {
      return cb(new Error('Only image files allowed (jpg, jpeg, png, webp, gif, bmp, heic)'));
    }
    if (file.mimetype && file.mimetype.startsWith('image/')) return cb(null, true);
    return cb(new Error('Only image files allowed'));
  },
});

async function participant(bookingId, auth) {
  const result = await pool.query('SELECT id, customer_id, tailor_id FROM bookings WHERE id = $1', [bookingId]);
  if (result.rows.length === 0) return { found: false };
  const booking = result.rows[0];
  const allowed = (auth.type === 'tailor' && booking.tailor_id === auth.id)
    || (auth.type === 'user' && booking.customer_id === auth.id);
  return { found: true, allowed, booking };
}

const bookingRouter = express.Router();

bookingRouter.get('/:id/ironing-items', authenticateToken, async (req, res) => {
  try {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid booking ID' });
    const access = await participant(req.params.id, req.auth);
    if (!access.found) return res.status(404).json({ error: 'Booking not found' });
    if (!access.allowed) return res.status(403).json({ error: 'Access denied' });
    const itemsResult = await pool.query(
      'SELECT * FROM booking_ironing_items WHERE booking_id = $1 ORDER BY created_at',
      [req.params.id]
    );
    const itemIds = itemsResult.rows.map((item) => item.id);
    const photosByItem = {};
    if (itemIds.length > 0) {
      const photosResult = await pool.query(
        'SELECT * FROM ironing_item_photos WHERE ironing_item_id = ANY($1) ORDER BY display_order, created_at',
        [itemIds]
      );
      photosResult.rows.forEach((photo) => {
        if (!photosByItem[photo.ironing_item_id]) photosByItem[photo.ironing_item_id] = [];
        photosByItem[photo.ironing_item_id].push(photo);
      });
    }
    return res.json({
      items: itemsResult.rows.map((item) => ({ ...item, photos: photosByItem[item.id] || [] })),
    });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
});

bookingRouter.post('/:id/ironing-items/:itemId/photos', authenticateToken, async (req, res, next) => {
  if (!validateId(req.params.id) || !validateId(req.params.itemId)) return res.status(400).json({ error: 'Invalid ID' });
  try {
    const access = await participant(req.params.id, req.auth);
    if (!access.found) return res.status(404).json({ error: 'Booking not found' });
    if (!access.allowed) return res.status(403).json({ error: 'Access denied' });
  } catch (e) {
    return res.status(500).json({ error: 'Upload validation failed' });
  }
  return photoUpload.single('photo')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5 MB or smaller' : (err.message || 'Upload failed');
      return res.status(400).json({ error: message });
    }
    return next();
  });
}, async (req, res) => {
  const uploadedPath = req.file ? req.file.path : null;
  try {
    if (uploadedPath && !looksLikeImageFile(uploadedPath)) {
      removeFile(uploadedPath);
      return res.status(400).json({ error: 'Uploaded file is not a valid image' });
    }
    if (!req.file) return res.status(400).json({ error: 'No photo file provided' });
    const itemResult = await pool.query(
      'SELECT * FROM booking_ironing_items WHERE id = $1 AND booking_id = $2',
      [req.params.itemId, req.params.id]
    );
    if (itemResult.rows.length === 0) {
      removeFile(uploadedPath);
      return res.status(404).json({ error: 'Ironing item not found' });
    }
    const countResult = await pool.query('SELECT COUNT(*) FROM ironing_item_photos WHERE ironing_item_id = $1', [req.params.itemId]);
    if (parseInt(countResult.rows[0].count, 10) >= MAX_PHOTOS_PER_IRONING_ITEM) {
      removeFile(uploadedPath);
      return res.status(409).json({ error: `Maximum ${MAX_PHOTOS_PER_IRONING_ITEM} photos per item` });
    }
    const id = crypto.randomUUID();
    const photoUrl = `/uploads/${req.file.filename}`;
    const order = parseInt(countResult.rows[0].count, 10);
    await pool.query(
      'INSERT INTO ironing_item_photos (id, ironing_item_id, photo_url, is_primary, display_order, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, req.params.itemId, photoUrl, order === 0 ? 1 : 0, order, new Date().toISOString()]
    );
    const created = await pool.query('SELECT * FROM ironing_item_photos WHERE id = $1', [id]);
    return res.json({ photo: created.rows[0] });
  } catch (e) {
    removeFile(uploadedPath);
    return res.status(500).json({ error: 'Photo upload failed' });
  }
});

const photoRouter = express.Router();

photoRouter.delete('/:photoId', authenticateToken, async (req, res) => {
  try {
    if (!validateId(req.params.photoId)) return res.status(400).json({ error: 'Invalid photo ID' });
    const result = await pool.query(
      `SELECT p.*, i.booking_id FROM ironing_item_photos p
       JOIN booking_ironing_items i ON i.id = p.ironing_item_id
       WHERE p.id = $1`,
      [req.params.photoId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Photo not found' });
    const photo = result.rows[0];
    const access = await participant(photo.booking_id, req.auth);
    if (!access.found || !access.allowed) return res.status(403).json({ error: 'Access denied' });
    await pool.query('DELETE FROM ironing_item_photos WHERE id = $1', [req.params.photoId]);
    const fileName = path.basename(photo.photo_url || '');
    if (fileName && !fileName.includes('..')) removeFile(path.join(uploadsDir, fileName));
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = { bookingRouter, photoRouter };
