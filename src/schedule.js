const VALID_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validateWorkingHours(hours) {
  if (!hours || typeof hours !== 'object') return false;
  for (const day of Object.keys(hours)) {
    if (!VALID_DAYS.includes(day)) return false;
    const entry = hours[day];
    if (typeof entry !== 'object') return false;
    if (entry.enabled === true) {
      if (!entry.open || !entry.close) return false;
      if (!TIME_RE.test(entry.open) || !TIME_RE.test(entry.close)) return false;
      if (entry.open >= entry.close) return false;
    }
  }
  return true;
}

function getDefaultWorkingHours() {
  const hours = {};
  for (const day of VALID_DAYS) {
    hours[day] = day === 'sunday'
      ? { enabled: false }
      : { enabled: true, open: '10:00', close: '19:00' };
  }
  return hours;
}

function parseWorkingHours(raw) {
  let hours = raw;
  if (typeof hours === 'string') {
    try { hours = JSON.parse(hours); } catch (e) { hours = null; }
  }
  if (hours && typeof hours === 'object' && Object.keys(hours).length > 0) return hours;
  return getDefaultWorkingHours();
}

function dayName(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return names[date.getUTCDay()];
}

function isWorkingDay(workingHours, dateStr) {
  const hours = workingHours[dayName(dateStr)];
  return Boolean(hours && hours.enabled === true);
}

function getWorkingHoursForDay(workingHours, dateStr) {
  return workingHours[dayName(dateStr)] || null;
}

function generateTimeSlots(openTime, closeTime, durationMinutes) {
  const slots = [];
  const [openHour, openMinute] = openTime.split(':').map(Number);
  const [closeHour, closeMinute] = closeTime.split(':').map(Number);
  const openMin = openHour * 60 + openMinute;
  const closeMin = closeHour * 60 + closeMinute;
  for (let minute = openMin; minute + durationMinutes <= closeMin; minute += durationMinutes) {
    const hour = Math.floor(minute / 60);
    const min = minute % 60;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    slots.push(`${hour12}:${min.toString().padStart(2, '0')} ${ampm}`);
  }
  return slots;
}

module.exports = { parseWorkingHours, validateWorkingHours, isWorkingDay, getWorkingHoursForDay, generateTimeSlots };
