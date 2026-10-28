const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9]{7,15}$/;
const ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function validateEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email);
}

function validatePhone(phone) {
  return typeof phone === 'string' && PHONE_RE.test(phone);
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 6 && password.length <= 128;
}

function validateId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

function safeName(value) {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 100;
}

function safeText(value, max = 2000) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

module.exports = { validateEmail, validatePhone, validatePassword, validateId, safeName, safeText };
