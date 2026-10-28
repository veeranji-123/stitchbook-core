const VALID_STATUSES = ['booked', 'confirmed', 'inProgress', 'readyForPickup', 'completed', 'cancelled'];
const VALID_PAYMENT_METHODS = ['cash', 'razorpay'];
const VALID_PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'cancelled', 'refunded'];
const VALID_DELIVERY = ['pickup', 'door_delivery'];
const VALID_UNITS = ['cm', 'inches'];
const VALID_GARMENT_TYPES = ['general', 'shirt', 'pant', 'tshirt', 'trouser', 'suit', 'blouse', 'kurta', 'lehenga', 'gown', 'jacket', 'dress', 'salwar', 'iron'];
const MAX_MEASUREMENT_FIELDS = 20;
const MAX_IRONING_ITEMS_PER_BOOKING = 30;
const IRONING_DEFAULT_TURNAROUND_DAYS = 1;
const MAX_TURNAROUND_DAYS = 60;

const VALID_TRANSITIONS = {
  booked: ['confirmed', 'cancelled'],
  confirmed: ['inProgress', 'cancelled'],
  inProgress: ['readyForPickup', 'cancelled'],
  readyForPickup: ['completed'],
  completed: [],
  cancelled: [],
};

const VALID_PAYMENT_TRANSITIONS = {
  pending: ['paid', 'failed', 'cancelled'],
  paid: ['refunded'],
  failed: ['pending'],
  cancelled: ['pending'],
  refunded: [],
};

function isValidTransition(from, to) {
  return VALID_TRANSITIONS[from]?.includes(to) === true;
}

function isValidPaymentTransition(from, to) {
  return VALID_PAYMENT_TRANSITIONS[from]?.includes(to) === true;
}

function validateBookingMeasurements(measurements) {
  if (!measurements || typeof measurements !== 'object') {
    return { valid: false, error: 'Measurements must be an object' };
  }
  const keys = Object.keys(measurements);
  if (keys.length > MAX_MEASUREMENT_FIELDS) {
    return { valid: false, error: `Too many fields (max ${MAX_MEASUREMENT_FIELDS})` };
  }
  for (const key of keys) {
    if (typeof key !== 'string' || key.length > 50) return { valid: false, error: 'Invalid field name' };
    const value = measurements[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 500) {
      return { valid: false, error: `Invalid value for ${key}` };
    }
  }
  return { valid: true };
}

module.exports = {
  VALID_STATUSES,
  VALID_PAYMENT_METHODS,
  VALID_PAYMENT_STATUSES,
  VALID_DELIVERY,
  VALID_UNITS,
  VALID_GARMENT_TYPES,
  MAX_IRONING_ITEMS_PER_BOOKING,
  IRONING_DEFAULT_TURNAROUND_DAYS,
  MAX_TURNAROUND_DAYS,
  isValidTransition,
  isValidPaymentTransition,
  validateBookingMeasurements,
};
