-- Track WHERE a snapshot's EUR rate came from, so the UI can label each
-- foreign-currency row with its provenance and let an operator override
-- the rate when the auto-pick is wrong.
--
-- Kinds:
--   'historical' -- eur_rate_date <= the row's own date (normal ECB match)
--   'fallback'   -- the stored rate's date is AFTER the row's date
--                   (no historical rate existed at write time)
--   'manual'     -- an operator overrode this specific row's rate
--                   via the per-row Edit modal
--
-- The combination (eur_rate_date, currency) still resolves to a row in
-- exchange_rates whose `source` is 'ecb' or 'manual'; this column tells
-- us HOW that rate got applied to this specific payment/charge.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS eur_rate_kind VARCHAR(16);

ALTER TABLE charges
  ADD COLUMN IF NOT EXISTS eur_rate_kind VARCHAR(16);

-- Sanity CHECK so a stray value can't sneak in.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_eur_rate_kind_check'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_eur_rate_kind_check
      CHECK (eur_rate_kind IS NULL OR eur_rate_kind IN ('historical', 'fallback', 'manual'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'charges_eur_rate_kind_check'
  ) THEN
    ALTER TABLE charges
      ADD CONSTRAINT charges_eur_rate_kind_check
      CHECK (eur_rate_kind IS NULL OR eur_rate_kind IN ('historical', 'fallback', 'manual'));
  END IF;
END$$;
