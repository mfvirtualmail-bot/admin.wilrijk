# FX & multi-currency

All money is stored in its **original** currency. Conversion to EUR happens
only at display time (dashboard totals, reports) and in PDFs.

## Rate storage — `settings` table, not a dedicated table

Rates live in a single JSONB row of `settings` under key `fx_rates`:

```json
{
  "2026-04-16": {
    "USD": { "rate": 1.0891, "source": "ecb",    "updated_at": "…" },
    "GBP": { "rate": 0.8543, "source": "manual", "updated_at": "…" }
  },
  "2026-04-15": { … }
}
```

Rate is "amount of C per 1 EUR" (ECB convention). To convert C → EUR:
`amount / rate`.

**Why settings table and not an `exchange_rates` table?** We originally shipped
migration `003_exchange_rates.sql` but it was never applied in production
Supabase, so `/api/fx/refresh` failed with "Could not find the table
'public.exchange_rates' in the schema cache." Moving storage into the
existing `settings` KV row eliminates the migration dependency — every deploy
"just works."

All reads/writes go through `src/lib/fx.ts`. Do not touch the JSON shape
without updating every helper in that file.

## Public API in `src/lib/fx.ts`

- `listRates(filter?)` — flat list for the Advanced Settings table.
- `putRate(date, currency, rate, source)` — upsert a single rate.
- `deleteRate(date, currency)` — remove one (falls back to previous rate).
- `getRate(date, currency)` — single lookup with date fallback.
- `getRatesBulk(pairs)` — batch lookup, one DB read.
- `convertToEur(amount, currency, date)` — single record convert.
- `convertManyToEur(records)` — batch convert with breakdown + missing-list.
- `fetchEcbDailyRates({ force, range })` — pull ECB XML and upsert.

## Date fallback

`findNewestOnOrBefore(map, target, currency)` returns the newest rate whose
date is `≤ target`. ECB doesn't publish weekends or holidays, so Friday's
rate applies Sat/Sun, and a 2026-01-01 charge falls back to the last
business day of 2025. Standard banking behaviour.

## 1:1 fallback for missing rates — CRITICAL INVARIANT

When `convertManyToEur` cannot find a rate for a record, it **does not
drop the record**. It counts the amount at face value (1:1 EUR), pushes
the record into `missing[]`, and sets `approximated: true` on the
breakdown row.

**Why this matters:** in April 2026 the dashboard "Outstanding balance"
appeared as €0. Root cause: migration never applied → `fx_rates` map empty
→ every non-EUR item dropped from both the "charged" and "paid" totals →
charged (€391,940) < paid (€410,790) → `Math.max(0, charged - paid) = 0`.
The user saw this as catastrophic data loss.

Rule: an approximated total with a clear warning is always better than
silently omitting real charges. Never "fail closed" on missing rates.

The warning UI is in `src/components/ConversionBreakdown.tsx` — amber
banner: "N items have no exchange rate on file and were counted at face
value (1:1 to EUR) so the total above is approximate."

## ECB ingestion ranges

`fetchEcbDailyRates({ range })` accepts three ranges:

| Range   | ECB URL                              | When used                          |
|---------|--------------------------------------|------------------------------------|
| `daily` | `eurofxref-daily.xml`                | Nightly cron — today only          |
| `90d`   | `eurofxref-hist-90d.xml`             | (unused by default now)            |
| `2y`    | `eurofxref-hist.xml` + client filter | Manual "Refresh from ECB" button   |

Default is `"2y"`. The full-history file is ~25 years; we filter to the
trailing 24 months via `cutoffIso` (today minus 2 years) inside the parse
loop so the stored map stays bounded. User explicitly asked for 2-year
window: "I only need the history. Of the last two years. Not the last 25."

ECB XML quirks:

- Attributes are **single-quoted** (`time='2026-04-16'`). The regex must
  accept `["']` for both `time=` and `currency=/rate=` to be safe — this
  caused a "parsed 0 rates" production bug (fix: commit `5687103`).
- The daily file may be flat (no outer time-scoped `<Cube>` wrapping the
  rate entries). `fetchEcbDailyRates` has a fallback regex for that case.
- Only `USD` and `GBP` are ingested (the `SUPPORTED` set). Add new
  currencies by extending that set — no schema change needed.

## Cron wiring

`vercel.json` → `/api/fx/cron` daily at 06:00 UTC. The cron passes
`range: "daily"` explicitly so the scheduled job stays tiny. Manual
refresh from the Advanced Settings button hits `/api/fx/refresh` which
uses the default 2-year range.

`CRON_SECRET` (if set) gates both cron endpoints via `Authorization:
Bearer $CRON_SECRET`.

## UI surfaces

- `src/app/(dashboard)/settings/page.tsx` — Advanced tab: rate table,
  manual add, "Refresh from ECB" button.
- `src/components/ConversionBreakdown.tsx` — reusable accordion used by
  the dashboard and any other page that shows a mixed-currency total.
- `src/lib/payment-utils.ts` — `formatCurrency`, `formatEur`,
  `CURRENCY_SYMBOLS`, `CURRENCY_OPTIONS`.

## USD must remain exposed

User has twice caught us for removing the `$` option from currency
pickers. USD stays in `CURRENCY_OPTIONS`. Pickers live on:

- `/payments/new`
- `/families/[id]` (Add Payment form)
- `/payments/import` (wizard Step 1)
