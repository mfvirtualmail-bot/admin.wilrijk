# Gotchas — regressions that have bitten us

Read this before changing anything that touches money, dates, Hebrew
text, or Vercel file tracing.

## 1. Dashboard "Outstanding balance" collapsing to €0

**Date seen:** April 2026. **Fix:** commit `252adba`.

Phase 4 introduced FX conversion. When the `exchange_rates` table didn't
exist in production (the migration was never applied), every non-EUR
record silently dropped out of `convertManyToEur`. Charged became
€391,940 (all EUR records only); Paid became €410,790 (same). `Math.max(0,
charged - paid)` returned 0. The user saw the dashboard claim they had no
outstanding balance when in fact ~€50,000 was owed.

**Invariant:** missing rates → 1:1 fallback, `approximated: true`, banner
warning. Never drop records. See `fx-currency.md`.

## 2. ECB XML — "parsed 0 rates"

**Date seen:** March 2026. **Fix:** commit `5687103`.

ECB switched to single-quoted attributes (`time='…'`) at some point. Our
regex only matched double quotes, so the nightly cron silently inserted
nothing and new days never got rates.

**Invariant:** ECB-parsing regexes must accept `["']` for both `time=`
and `currency=/rate=`. Don't assume either quote style.

## 3. PDF font `ENOENT` on Vercel

**Date seen:** March 2026 (when we first built the PDF feature) and
again a month later after a config drift. **Fix:** commit `661610e` →
cherry-picked as `44a2486`.

Two separate traps:

- `.woff` files from `@fontsource/noto-sans-hebrew` work locally but
  Vercel strips them. Must use TTF committed in `./fonts/`.
- Even TTF gets stripped unless `next.config.mjs` declares
  `outputFileTracingIncludes` for every route that renders a PDF.

**Invariant:** see `email-pdf.md`. `pdf-statement.tsx` must THROW if the
font is missing — do not fall back to Helvetica silently.

## 4. Excel date swap

**Date seen:** February 2026. **Fix:** commit `c75a03b`.

`xlsx` parsed with defaults reformatted Date cells using the host locale;
on a US-locale server, 03-02-2026 came back as "Feb 3" when the sheet
meant "3 Feb." The app then re-parsed it as MM-DD-YYYY.

**Invariant:** see `excel.md`. Read sheets with `{ raw: true }`,
`parseEuropeanDate` handles `Date` objects via `formatLocalISODate`, and
never route a date through `toISOString()`.

## 5. Gmail app password silently truncated

**Date seen:** March 2026. **Fix:** commit `71d5105`.

Gmail displays the 16-character app password in groups of 4 with spaces.
Users paste it with the spaces. Nodemailer accepts the whitespace but
auth fails anyway. We now strip whitespace from the password on save
and offer a "Test SMTP" button that surfaces auth errors.

**Invariant:** strip whitespace from user-pasted secrets. Always provide
a "test this config" button for anything that talks to an external service.

## 6. USD dropped from currency picker

**Date seen:** twice, once in Phase 4 and once in Phase 6. **Fix:** keep
USD in `CURRENCY_OPTIONS` in `src/lib/payment-utils.ts`.

Cleanup passes have twice removed `$` from the picker thinking it was
unused. The user imports USD payments regularly.

**Invariant:** never narrow `CURRENCY_OPTIONS` without asking.

## 7. "Total charged" = `tuition * 12`

**Date seen:** February 2026. **Fix:** commit `c75a03b`.

The dashboard computed charges as `monthly_tuition * 12` which bills the
whole academic year up front. Parents on month 3 looked overdue for
months 4–12.

**Invariant:** sum the `charges` table filtered by year+month ≤ today.
Don't recompute from `monthly_tuition`.

## 8. Yiddish template offering Latin-only placeholders

**Date seen:** April 2026. **Fix:** commit `fb83f61`.

Every placeholder was shown regardless of locale, so Yiddish templates
had to be hand-edited to insert `{{hebrew_family_name}}` and the user
kept getting emails that mixed Hebrew body with Latin names.

**Invariant:** `TEMPLATE_PLACEHOLDERS` tags each entry
`"en" | "yi" | "both"` and the palette filters by the selected tab.
