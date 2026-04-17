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
  hebrew_name VARCHAR(200),          -- Hebrew family name
  hebrew_father_name VARCHAR(200),   -- Hebrew father's name
  address TEXT,
  city VARCHAR(100),
  postal_code VARCHAR(20),
  phone VARCHAR(50),
  email VARCHAR(200),
  language VARCHAR(5) NOT NULL DEFAULT 'en',  -- preferred language for emails: en, yi
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
  hebrew_name VARCHAR(200),          -- Hebrew name of the student
  date_of_birth DATE,
  class_name VARCHAR(100),
  monthly_tuition DECIMAL(10,2) NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'EUR',  -- EUR, USD, GBP
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  enrollment_date DATE,
  enrollment_start_month SMALLINT DEFAULT 9,   -- Academic start month (default Sep)
  enrollment_start_year SMALLINT,              -- Academic start year
  enrollment_end_month SMALLINT DEFAULT 8,     -- Academic end month (default Aug)
  enrollment_end_year SMALLINT,                -- Academic end year
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
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
  -- EUR snapshot, set on write (see 004_eur_snapshot.sql).
  eur_amount NUMERIC(12, 2),
  eur_rate NUMERIC(14, 6),
  eur_rate_date DATE,
  -- How the rate was picked: 'historical' | 'fallback' | 'manual' (005_eur_rate_kind.sql).
  eur_rate_kind VARCHAR(16)
    CHECK (eur_rate_kind IS NULL OR eur_rate_kind IN ('historical', 'fallback', 'manual')),
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
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
  payment_date DATE NOT NULL,
  payment_method VARCHAR(20) NOT NULL,  -- 'crc' (credit card), 'kas' (cash), 'bank', 'other'
  month SMALLINT CHECK (month BETWEEN 1 AND 12),  -- which month this payment covers
  year SMALLINT,
  reference VARCHAR(200),
  -- EUR snapshot, set on write (see 004_eur_snapshot.sql).
  eur_amount NUMERIC(12, 2),
  eur_rate NUMERIC(14, 6),
  eur_rate_date DATE,
  -- How the rate was picked: 'historical' | 'fallback' | 'manual' (005_eur_rate_kind.sql).
  eur_rate_kind VARCHAR(16)
    CHECK (eur_rate_kind IS NULL OR eur_rate_kind IN ('historical', 'fallback', 'manual')),
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

-- Email settings: singleton row (id=1). Stores SMTP credentials + org branding.
CREATE TABLE IF NOT EXISTS email_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  smtp_host VARCHAR(200) NOT NULL DEFAULT 'smtp.gmail.com',
  smtp_port INTEGER NOT NULL DEFAULT 465,
  smtp_secure BOOLEAN NOT NULL DEFAULT TRUE,
  smtp_user VARCHAR(200),
  smtp_password TEXT,
  from_name VARCHAR(200) NOT NULL DEFAULT 'Beit Midrash Wilrijk',
  from_email VARCHAR(200),
  reply_to VARCHAR(200),
  bcc_admin VARCHAR(200),
  org_name VARCHAR(200) NOT NULL DEFAULT 'Beit Midrash Wilrijk',
  org_address TEXT,
  org_logo_url TEXT,
  payment_instructions TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO email_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Email templates: subject + body per language, with {{placeholders}}.
CREATE TABLE IF NOT EXISTS email_templates (
  locale VARCHAR(5) PRIMARY KEY,
  subject VARCHAR(500) NOT NULL,
  body TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Email send log for audit + debugging.
CREATE TABLE IF NOT EXISTS email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID REFERENCES families(id) ON DELETE SET NULL,
  to_email VARCHAR(200) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  locale VARCHAR(5) NOT NULL,
  status VARCHAR(20) NOT NULL,
  error TEXT,
  sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
  balance_at_send DECIMAL(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_log_family ON email_log(family_id);
CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at);

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
