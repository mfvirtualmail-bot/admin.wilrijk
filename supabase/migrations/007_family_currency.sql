-- 007_family_currency.sql
--
-- Move currency from per-child to per-family. The new Bais Rachel-style
-- statement renders a single family-level ledger in one currency, so each
-- family now has exactly one statement currency. Child-level currency is
-- deprecated (we'll keep the column in place for one release so existing
-- code paths don't break, then drop it in a later migration once all
-- readers use families.currency).
--
-- Backfill rule: use the currency of the family's active children. Query 1
-- (pre-migration audit) confirmed zero families currently have children
-- with mixed currencies, so MIN() is unambiguous. Families with no active
-- children default to EUR.
--
-- Idempotent: safe to re-run.

ALTER TABLE families
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'EUR'
    CHECK (currency IN ('EUR', 'USD', 'GBP'));

-- Backfill: set each family's currency to match its active children (if any).
-- Skips families already explicitly set to something other than EUR.
UPDATE families f
SET currency = sub.cur
FROM (
  SELECT family_id, MIN(currency) AS cur
  FROM children
  WHERE is_active = true
  GROUP BY family_id
) sub
WHERE f.id = sub.family_id
  AND f.currency = 'EUR'  -- only overwrite the default
  AND sub.cur IS NOT NULL
  AND sub.cur <> 'EUR';
