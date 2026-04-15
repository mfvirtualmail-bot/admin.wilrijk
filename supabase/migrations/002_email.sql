-- Email templates + PDF statements
-- Run this migration on top of the base schema.sql

-- Add per-family preferred language for bulk sends (en/yi; extensible)
ALTER TABLE families
  ADD COLUMN IF NOT EXISTS language VARCHAR(5) NOT NULL DEFAULT 'en';

-- Email settings live as a singleton row keyed by id=1. Storing the SMTP
-- password in the DB is OK here: the Supabase service role key is never
-- exposed to the browser, and only the super-admin can read/write the row
-- via /api/email/settings (which enforces auth).
CREATE TABLE IF NOT EXISTS email_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  smtp_host VARCHAR(200) NOT NULL DEFAULT 'smtp.gmail.com',
  smtp_port INTEGER NOT NULL DEFAULT 465,
  smtp_secure BOOLEAN NOT NULL DEFAULT TRUE,
  smtp_user VARCHAR(200),           -- Gmail address, e.g. gabbai@...
  smtp_password TEXT,               -- Gmail app password (16 chars, no spaces)
  from_name VARCHAR(200) NOT NULL DEFAULT 'Beit Midrash Wilrijk',
  from_email VARCHAR(200),          -- defaults to smtp_user when null
  reply_to VARCHAR(200),
  bcc_admin VARCHAR(200),           -- optional BCC on every send
  org_name VARCHAR(200) NOT NULL DEFAULT 'Beit Midrash Wilrijk',
  org_address TEXT,
  org_logo_url TEXT,                -- URL shown in PDF + email header
  payment_instructions TEXT,        -- IBAN + payment methods, shown at bottom of PDF
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO email_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Per-language email template. Subject + body (plain text with {{placeholders}},
-- newlines rendered as paragraph breaks in the HTML email).
CREATE TABLE IF NOT EXISTS email_templates (
  locale VARCHAR(5) PRIMARY KEY,        -- 'en', 'yi', (and any future languages)
  subject VARCHAR(500) NOT NULL,
  body TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed with a sensible English + Yiddish default on first run.
INSERT INTO email_templates (locale, subject, body) VALUES
  ('en',
   'Tuition statement — {{family_name}}',
   'Dear {{contact_name}},

Please find attached the tuition statement for your family, dated {{statement_date}}.

Current balance due: {{balance}}.

If you have already paid since the date of this statement, please disregard the balance. Otherwise, we would be grateful if you could settle it at your earliest convenience.

Thank you,
{{org_name}}'),
  ('yi',
   'שכר לימוד — {{family_name}}',
   'חשובע משפחה {{contact_name}},

מיר שיקן אײַך צוגעבונדן דעם חשבון פֿאַר שכר לימוד, מיטן דאַטום {{statement_date}}.

איצטיקער חוב: {{balance}}.

אויב איר האָט שוין באצאָלט נאָך דעם דאַטום, איגנאָרירט ביטע. אַנדערש, אײַער באצאָל וועט מען זייער שעצן.

אַ האַרציקן דאַנק,
{{org_name}}')
ON CONFLICT (locale) DO NOTHING;

-- Log every outgoing email for audit + retry.
CREATE TABLE IF NOT EXISTS email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID REFERENCES families(id) ON DELETE SET NULL,
  to_email VARCHAR(200) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  locale VARCHAR(5) NOT NULL,
  status VARCHAR(20) NOT NULL,          -- 'sent' | 'failed' | 'test'
  error TEXT,
  sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
  balance_at_send DECIMAL(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_log_family ON email_log(family_id);
CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at);
