-- Snapshot the EUR equivalent of every payment and every charge at the
-- moment it's written, so totals never depend on later FX-rate availability.
--
-- Rationale: previously the dashboard re-converted every payment and
-- charge to EUR on each request, using the FX rate as of the payment_date
-- or the first day of the charge's month. When that lookup failed (no
-- rate published for that date and no earlier rate either), the row was
-- silently dropped from the total — making "Charged" understated and
-- pushing Outstanding Balance to €0 on screens with many cross-currency
-- entries. Now the conversion happens ONCE on write and the EUR value is
-- stored on the row itself.
--
-- `eur_amount` is the converted EUR value, rounded to 2 decimals. For
-- EUR-native rows it equals `amount` exactly. `eur_rate` is the rate that
-- was applied (amount of source currency per 1 EUR), kept for audit.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS eur_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS eur_rate   NUMERIC(14, 6),
  ADD COLUMN IF NOT EXISTS eur_rate_date DATE;

ALTER TABLE charges
  ADD COLUMN IF NOT EXISTS eur_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS eur_rate   NUMERIC(14, 6),
  ADD COLUMN IF NOT EXISTS eur_rate_date DATE;

-- Indexes so the dashboard can detect and self-heal NULL rows without
-- scanning the whole table.
CREATE INDEX IF NOT EXISTS payments_eur_amount_null_idx
  ON payments (id) WHERE eur_amount IS NULL;
CREATE INDEX IF NOT EXISTS charges_eur_amount_null_idx
  ON charges (id) WHERE eur_amount IS NULL;
