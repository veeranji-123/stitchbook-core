const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config');

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.auth = { id: decoded.id, email: decoded.email, type: decoded.type };
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireUser(req, res, next) {
  if (req.auth?.type !== 'user') return res.status(403).json({ error: 'Customer account required' });
  return next();
}

function requireTailor(req, res, next) {
  if (req.auth?.type !== 'tailor') return res.status(403).json({ error: 'Tailor account required' });
  return next();
}

module.exports = { authenticateToken, requireUser, requireTailor };
