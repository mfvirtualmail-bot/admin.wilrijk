-- Charges are now identified by (child_id, hebrew_month, hebrew_year) instead
-- of (child_id, Gregorian_month, year). This is what makes leap Hebrew years
-- able to hold 13 distinct charge rows per child (Adar I + Adar II), and also
-- fixes the edge case where two Rosh Chodesh fall in the same Gregorian month
-- (e.g. 1 Kislev + 1 Tevet both in Dec 2027) — previously those would upsert
-- into a single row.
--
-- Numbering convention: Hebrew months follow hebcal's scheme, 1=Nisan …
-- 6=Elul, 7=Tishrei … 12=Adar (or Adar I in leap years), 13=Adar II (leap
-- years only). That's why the CHECK allows 1..13.
--
-- The old Gregorian `month` + `year` columns STAY on the row — they hold the
-- Gregorian date of the Rosh Chodesh that generated the charge. Dashboard/FX
-- snapshots/statements still read those, so we avoid a sweeping rewrite.
--
-- Workflow to apply (safe, idempotent, no data loss):
--   1. Run this file in the Supabase SQL editor.
--   2. Hit the "Backfill Hebrew months" button in Settings → Advanced (or
--      POST /api/charges/backfill-hebrew) — it fills hebrew_month and
--      hebrew_year on every existing row using hebcal.
--   3. From that point on, the new charge generator writes both columns on
--      every insert, and the Rosh-Chodesh cron keeps new months in sync.
--
-- The old UNIQUE(child_id, month, year) is dropped because leap years need
-- multiple rows per Gregorian year. Its replacement is a PARTIAL unique
-- index on the Hebrew columns, so the constraint is valid even while some
-- rows still have NULL Hebrew fields (during the backfill window).

ALTER TABLE charges ADD COLUMN IF NOT EXISTS hebrew_month SMALLINT;
ALTER TABLE charges ADD COLUMN IF NOT EXISTS hebrew_year SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'charges_hebrew_month_check'
  ) THEN
    ALTER TABLE charges
      ADD CONSTRAINT charges_hebrew_month_check
      CHECK (hebrew_month IS NULL OR hebrew_month BETWEEN 1 AND 13);
  END IF;
END$$;

-- Drop the old Gregorian uniqueness. Auto-generated constraint name from
-- Postgres when UNIQUE(child_id, month, year) was declared inline on the
-- CREATE TABLE is `charges_child_id_month_year_key`.
ALTER TABLE charges DROP CONSTRAINT IF EXISTS charges_child_id_month_year_key;

-- Partial unique index so it's valid while rows still have NULL Hebrew
-- fields during backfill. After backfill, every row satisfies the WHERE
-- clause and the index effectively acts as a full unique constraint.
DROP INDEX IF EXISTS idx_charges_hebrew_unique;
CREATE UNIQUE INDEX idx_charges_hebrew_unique
  ON charges (child_id, hebrew_month, hebrew_year)
  WHERE hebrew_month IS NOT NULL AND hebrew_year IS NOT NULL;

-- Secondary index for range queries by Hebrew period
CREATE INDEX IF NOT EXISTS idx_charges_hebrew_period
  ON charges (hebrew_year, hebrew_month);
