-- Exchange rates for converting multi-currency payments to EUR.
-- One row per (date, currency); EUR against itself is never stored (rate=1
-- is implicit). ECB publishes only on working days; when a payment's date
-- has no rate, resolvers fall back to the last published rate before it.
CREATE TABLE IF NOT EXISTS exchange_rates (
  date DATE NOT NULL,
  currency VARCHAR(3) NOT NULL,          -- ISO code: 'USD', 'GBP', …
  rate NUMERIC(14, 6) NOT NULL,          -- amount of <currency> per 1 EUR
  source VARCHAR(10) NOT NULL DEFAULT 'ecb' CHECK (source IN ('ecb', 'manual')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (date, currency)
);

CREATE INDEX IF NOT EXISTS exchange_rates_currency_date_idx
  ON exchange_rates (currency, date DESC);
