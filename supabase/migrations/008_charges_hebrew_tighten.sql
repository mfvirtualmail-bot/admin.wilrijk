-- Tighten charges Hebrew-identity uniqueness. This is the second half of
-- the 006/006+backfill migration path: by now every row should have
-- hebrew_month and hebrew_year populated (via the new generator or the
-- POST /api/charges/backfill-hebrew endpoint) AND any (child_id,
-- hebrew_month, hebrew_year) duplicates that accumulated while the old
-- Gregorian generator + new Rosh-Chodesh generator ran in parallel should
-- already be collapsed (the backfill endpoint dedupes after filling).
--
-- This migration makes both of those guarantees enforceable:
--   - NOT NULL on hebrew_month / hebrew_year, so the generator can never
--     silently produce a pre-migration-shaped row again.
--   - A full (non-partial) unique constraint replaces the partial index,
--     so duplicate Hebrew identities are rejected at the DB level.
--
-- Prerequisite: POST /api/charges/backfill-hebrew was run after migration
-- 006. This migration will fail loudly if any rows still have NULL
-- Hebrew fields — do NOT bypass the check; fix the data first.

DO $$
DECLARE null_count bigint;
DECLARE dup_count bigint;
BEGIN
  SELECT count(*) INTO null_count
    FROM charges
    WHERE hebrew_month IS NULL OR hebrew_year IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION
      '% charge rows still have NULL hebrew_month/hebrew_year. Run POST /api/charges/backfill-hebrew first, then re-apply this migration.',
      null_count;
  END IF;

  SELECT count(*) INTO dup_count FROM (
    SELECT 1 FROM charges
    GROUP BY child_id, hebrew_month, hebrew_year
    HAVING count(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION
      '% (child_id, hebrew_month, hebrew_year) groups have duplicates. The backfill endpoint dedupes automatically — re-run POST /api/charges/backfill-hebrew.',
      dup_count;
  END IF;
END$$;

ALTER TABLE charges ALTER COLUMN hebrew_month SET NOT NULL;
ALTER TABLE charges ALTER COLUMN hebrew_year SET NOT NULL;

-- Replace the partial unique index with a full unique constraint.
DROP INDEX IF EXISTS idx_charges_hebrew_unique;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'charges_child_hebrew_month_year_key'
  ) THEN
    ALTER TABLE charges
      ADD CONSTRAINT charges_child_hebrew_month_year_key
      UNIQUE (child_id, hebrew_month, hebrew_year);
  END IF;
END$$;
