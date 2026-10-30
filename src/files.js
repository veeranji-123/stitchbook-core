const fs = require('fs');
const path = require('path');

const uploadsDir = path.join(__dirname, '..', 'uploads');
const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic'];

function ensureUploadsDir() {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
}

function looksLikeImageFile(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(12);
    const n = fs.readSync(fd, buf, 0, 12, 0);
    if (n < 3) return false;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
    if (buf.toString('ascii', 0, 3) === 'GIF') return true;
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return true;
    if (buf[0] === 0x42 && buf[1] === 0x4d) return true;
    if (buf.toString('ascii', 4, 8) === 'ftyp') return true;
    return false;
  } catch (e) {
    return false;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (e) { /* ignore */ }
    }
  }
}

function safeExtension(originalName) {
  const raw = path.extname(originalName || '').toLowerCase();
  return PHOTO_EXTENSIONS.includes(raw) ? raw : '';
}

function removeFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
  }
}

module.exports = { uploadsDir, PHOTO_EXTENSIONS, ensureUploadsDir, looksLikeImageFile, safeExtension, removeFile };
