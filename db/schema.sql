CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  email TEXT UNIQUE,
  password TEXT,
  referralcode TEXT,
  referredusers JSONB DEFAULT '[]'::jsonb,
  favorites JSONB DEFAULT '[]'::jsonb,
  measurements JSONB
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

CREATE TABLE IF NOT EXISTS tailors (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  email TEXT UNIQUE,
  password TEXT,
  shop_description TEXT DEFAULT '',
  address TEXT DEFAULT '',
  latitude DOUBLE PRECISION DEFAULT 0,
  longitude DOUBLE PRECISION DEFAULT 0,
  average_rating DOUBLE PRECISION DEFAULT 0,
  total_ratings INTEGER DEFAULT 0,
  stitching_days TEXT DEFAULT '{}',
  garment_types TEXT DEFAULT '[]',
  prices TEXT DEFAULT '{}',
  portfolio_images TEXT DEFAULT '[]',
  shop_type TEXT DEFAULT 'tailor',
  item_prices TEXT DEFAULT '{}',
  estimated_hours INTEGER DEFAULT 2,
  is_active INTEGER DEFAULT 1,
  working_hours TEXT DEFAULT '{}',
  slot_duration INTEGER DEFAULT 60,
  profile_image_url TEXT,
  offers_pickup_drop INTEGER DEFAULT 0,
  pickup_radius_km DOUBLE PRECISION DEFAULT 5,
  base_delivery_charge DOUBLE PRECISION DEFAULT 30
);

CREATE INDEX IF NOT EXISTS idx_tailors_email ON tailors(email);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  reference_number TEXT,
  tailor_id TEXT REFERENCES tailors(id) ON DELETE SET NULL,
  tailor_name TEXT,
  customer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_phone TEXT,
  customer_whatsapp TEXT,
  garment_type TEXT,
  amount DOUBLE PRECISION DEFAULT 0,
  payment_method TEXT DEFAULT 'cash',
  payment_status TEXT DEFAULT 'pending',
  slot_date TEXT,
  delivery_date TEXT,
  status TEXT DEFAULT 'booked',
  notes TEXT,
  tailor_notes TEXT,
  delivery_method TEXT DEFAULT 'pickup',
  delivery_charge DOUBLE PRECISION DEFAULT 0,
  pickup_address TEXT,
  pickup_latitude DOUBLE PRECISION,
  pickup_longitude DOUBLE PRECISION,
  pickup_landmark TEXT,
  pickup_phone TEXT,
  expected_completion_date TEXT,
  actual_completion_date TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_tailor_id ON bookings(tailor_id);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_phone ON bookings(customer_phone);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at);

CREATE TABLE IF NOT EXISTS ratings (
  id TEXT PRIMARY KEY,
  booking_id TEXT,
  tailor_id TEXT,
  customer_name TEXT,
  garment_type TEXT,
  stars INTEGER DEFAULT 5,
  comment TEXT,
  photo_url TEXT,
  tailor_reply TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ratings_tailor_id ON ratings(tailor_id);

CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  tailor_id TEXT,
  date TEXT,
  time_slot TEXT DEFAULT '10:00 AM',
  max_customers INTEGER DEFAULT 3,
  booked_customers INTEGER DEFAULT 0,
  is_blocked INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_slots_tailor_date ON slots(tailor_id, date);
CREATE INDEX IF NOT EXISTS idx_slots_tailor_date_timeslot ON slots(tailor_id, date, time_slot);

CREATE TABLE IF NOT EXISTS measurement_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  garment_type TEXT DEFAULT 'general',
  unit TEXT DEFAULT 'cm',
  measurements JSONB DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_measurement_profiles_user_id ON measurement_profiles(user_id);

CREATE TABLE IF NOT EXISTS booking_measurements (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tailor_id TEXT NOT NULL REFERENCES tailors(id) ON DELETE CASCADE,
  garment_type TEXT NOT NULL,
  unit TEXT DEFAULT 'cm',
  measurements JSONB DEFAULT '{}'::jsonb,
  source TEXT DEFAULT 'customer' CHECK (source IN ('customer', 'tailor_confirmed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_measurements_customer
  ON booking_measurements(booking_id, user_id) WHERE source = 'customer';
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_measurements_tailor
  ON booking_measurements(booking_id, tailor_id) WHERE source = 'tailor_confirmed';
CREATE INDEX IF NOT EXISTS idx_booking_measurements_booking_id ON booking_measurements(booking_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_type TEXT DEFAULT 'user',
  receiver_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_booking_id ON messages(booking_id);

CREATE TABLE IF NOT EXISTS tailor_stitching_speeds (
  id TEXT PRIMARY KEY,
  tailor_id TEXT NOT NULL REFERENCES tailors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  turnaround_days INTEGER NOT NULL,
  extra_charge DOUBLE PRECISION DEFAULT 0,
  is_enabled INTEGER DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ironing_service_types (
  id TEXT PRIMARY KEY,
  tailor_id TEXT NOT NULL REFERENCES tailors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price_per_item DOUBLE PRECISION NOT NULL DEFAULT 0,
  is_enabled INTEGER DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_items (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK (domain IN ('tailoring', 'ironing')),
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_booking_items_booking_id ON booking_items(booking_id);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stitching_speed_id TEXT REFERENCES tailor_stitching_speeds(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ironing_service_type_id TEXT REFERENCES ironing_service_types(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS booking_ironing_items (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_type_id TEXT REFERENCES ironing_service_types(id) ON DELETE SET NULL,
  service_type_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  price_per_item DOUBLE PRECISION NOT NULL DEFAULT 0,
  customer_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_booking_ironing_items_booking_id ON booking_ironing_items(booking_id);
