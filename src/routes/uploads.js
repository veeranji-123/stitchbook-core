const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { authenticateToken, requireTailor } = require('../middleware/auth');
const { validateId } = require('../validate');
const { uploadsDir, ensureUploadsDir, looksLikeImageFile, safeExtension, removeFile, PHOTO_EXTENSIONS } = require('../files');

ensureUploadsDir();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = safeExtension(file.originalname);
    cb(null, `${req.params.id}_${Date.now()}${ext}`);
  },
});

function imageUpload(field) {
  const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = pathExt(file.originalname);
      if (!PHOTO_EXTENSIONS.includes(ext)) return cb(new Error('Only image files allowed (jpg, jpeg, png, webp, gif, bmp, heic)'));
      if (file.mimetype && file.mimetype.startsWith('image/')) return cb(null, true);
      return cb(new Error('Only image files allowed'));
    },
  }).single(field);
  return (req, res, next) => {
    upload(req, res, (err) => {
      if (!err) return next();
      removeFile(req.file && req.file.path);
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5 MB or smaller' : (err.message || 'Invalid image upload');
      return res.status(400).json({ error: message });
    });
  };
}

function pathExt(name) {
  const raw = require('path').extname(name || '').toLowerCase();
  return raw;
}

function requireSelf(req, res, next) {
  if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid tailor ID' });
  if (req.auth.id !== req.params.id) return res.status(403).json({ error: 'Cannot modify another tailor\'s profile' });
  return next();
}

const router = express.Router();

router.post('/:id/upload-image', authenticateToken, requireTailor, requireSelf, imageUpload('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    if (!looksLikeImageFile(req.file.path)) {
      removeFile(req.file.path);
      return res.status(400).json({ error: 'Uploaded file is not a valid image' });
    }
    const imageUrl = `/uploads/${req.file.filename}`;
    await pool.query('UPDATE tailors SET profile_image_url = $1 WHERE id = $2', [imageUrl, req.params.id]);
    return res.json({ imageUrl, success: true });
  } catch (e) {
    removeFile(req.file && req.file.path);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

router.post('/:id/upload-portfolio', authenticateToken, requireTailor, requireSelf, imageUpload('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    if (!looksLikeImageFile(req.file.path)) {
      removeFile(req.file.path);
      return res.status(400).json({ error: 'Uploaded file is not a valid image' });
    }
    const imageUrl = `/uploads/${req.file.filename}`;
    const existing = await pool.query('SELECT portfolio_images FROM tailors WHERE id = $1', [req.auth.id]);
    if (existing.rows.length === 0) {
      removeFile(req.file.path);
      return res.status(404).json({ error: 'Tailor not found' });
    }
    let portfolio = [];
    try {
      const parsed = JSON.parse(existing.rows[0].portfolio_images || '[]');
      if (Array.isArray(parsed)) portfolio = parsed;
    } catch (e) {
      portfolio = [];
    }
    portfolio.push(imageUrl);
    await pool.query('UPDATE tailors SET portfolio_images = $1 WHERE id = $2', [JSON.stringify(portfolio), req.auth.id]);
    return res.json({ imageUrl, success: true });
  } catch (e) {
    removeFile(req.file && req.file.path);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

module.exports = router;
