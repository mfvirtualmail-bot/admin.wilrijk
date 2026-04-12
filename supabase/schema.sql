-- Admin Wilrijk — Tuition Management System
-- Database Schema for Supabase (PostgreSQL)

-- Users table: authentication and preferences
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,       -- PBKDF2/SHA-512
  salt TEXT NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  language VARCHAR(5) NOT NULL DEFAULT 'en',  -- en, nl, yi
  is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions table: cookie-based token management
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- User permissions: flexible module-action pairs
CREATE TABLE IF NOT EXISTS user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module VARCHAR(50) NOT NULL,   -- families, children, charges, payments, spreadsheet, reports, users, settings
  action VARCHAR(20) NOT NULL,   -- view, add, edit, delete
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, module, action)
);

CREATE INDEX idx_permissions_user ON user_permissions(user_id);

-- Families table: parent/family records
CREATE TABLE IF NOT EXISTS families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  father_name VARCHAR(200),
  mother_name VARCHAR(200),
  address TEXT,
  city VARCHAR(100),
  postal_code VARCHAR(20),
  phone VARCHAR(50),
  email VARCHAR(200),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Children table: student records linked to families
CREATE TABLE IF NOT EXISTS children (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  first_name VARCHAR(200) NOT NULL,
  last_name VARCHAR(200) NOT NULL,
  date_of_birth DATE,
  class_name VARCHAR(100),
  monthly_tuition DECIMAL(10,2) NOT NULL DEFAULT 0,  -- EUR
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  enrollment_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_children_family ON children(family_id);

-- Charges table: monthly per-child tuition entries
CREATE TABLE IF NOT EXISTS charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year SMALLINT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,  -- EUR
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(child_id, month, year)
);

CREATE INDEX idx_charges_family ON charges(family_id);
CREATE INDEX idx_charges_child ON charges(child_id);
CREATE INDEX idx_charges_period ON charges(year, month);

-- Payments table: family-level payments
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,   -- EUR
  payment_date DATE NOT NULL,
  payment_method VARCHAR(20) NOT NULL,  -- 'crc' (credit card), 'kas' (cash), 'bank', 'other'
  month SMALLINT CHECK (month BETWEEN 1 AND 12),  -- which month this payment covers
  year SMALLINT,
  reference VARCHAR(200),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_family ON payments(family_id);
CREATE INDEX idx_payments_date ON payments(payment_date);
CREATE INDEX idx_payments_period ON payments(year, month);

-- Settings table: key-value configuration store
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit log: JSONB-based change tracking
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL,        -- create, update, delete
  table_name VARCHAR(100) NOT NULL,
  record_id UUID,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_table ON audit_log(table_name);
CREATE INDEX idx_audit_log_record ON audit_log(record_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);

-- Seed: default super admin (password: "admin123" — change immediately)
-- Salt and hash generated with PBKDF2-SHA512, 100000 iterations
-- This is a placeholder; the app generates proper hashes at runtime
INSERT INTO settings (key, value) VALUES
  ('school_name', '"Beit Midrash Wilrijk"'),
  ('currency', '"EUR"'),
  ('academic_year_start_month', '9'),
  ('academic_year_end_month', '8'),
  ('payment_method_labels', '{"crc":"Credit Card","kas":"Cash","bank":"Bank Transfer","other":"Other"}'),
  ('default_payment_method', '"kas"')
ON CONFLICT (key) DO NOTHING;
