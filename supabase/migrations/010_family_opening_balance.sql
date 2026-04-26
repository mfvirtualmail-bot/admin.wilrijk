-- 010_family_opening_balance.sql
--
-- Add a per-family opening balance carried over from a previous year the
-- school has not yet imported into the system. This is a family-level
-- workaround — not tied to any student — that appears as the first row of
-- the statement and drains first under FIFO payment allocation.
--
-- Amount is stored in the family's statement currency (families.currency);
-- no FX snapshot needed because the statement is already rendered in that
-- currency.
--
-- Idempotent: safe to re-run.

ALTER TABLE families
  ADD COLUMN IF NOT EXISTS opening_balance_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_balance_label  TEXT;
