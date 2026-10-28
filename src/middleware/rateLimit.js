const rateLimitStore = new Map();

function rateLimit({ windowMs = 60000, max = 30 } = {}) {
  return (req, res, next) => {
    const bucket = req.path.startsWith('/api/auth') ? 'auth' : 'general';
    const key = `${req.ip}:${bucket}`;
    const now = Date.now();
    let entry = rateLimitStore.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      rateLimitStore.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    return next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now - entry.start > 120000) rateLimitStore.delete(key);
  }
}, 300000).unref();

module.exports = { rateLimit };
