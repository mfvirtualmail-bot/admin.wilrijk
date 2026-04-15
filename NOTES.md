# Admin Wilrijk — Working Notes

Persistent notes for Claude sessions so context survives between conversations.
Update this file whenever you change behaviour that a future session would need
to re-discover.

---

## Recent work (branch `claude/fix-excel-import-dates-GZLaC`)

### Commit `c75a03b` — Excel dates & prorated charges
- **Excel date swap fix**: `src/lib/excel-utils.ts` now parses sheets with
  `raw: true` so Date cells survive as `Date` objects. `parseEuropeanDate`
  accepts `Date | number | string`, using `formatLocalISODate` to emit
  `YYYY-MM-DD` from local fields (no UTC shift). This fixes the DD-MM vs MM-DD
  ambiguity that caused date swaps when xlsx reformatted cells using a US
  locale.
- **Prorated "Total Charged"**: every place that computed total charges was
  summing the whole academic year. Now each route filters the `charges` table
  to rows where `year*12 + month <= currentYear*12 + currentMonth`:
  - `src/app/api/families/[id]/route.ts`
  - `src/app/api/dashboard/route.ts` (no longer uses `tuition * 12`)
  - `src/app/api/reports/route.ts`
  - `src/app/api/spreadsheet/route.ts`
  The `charges` table already bakes in per-student enrollment windows via
  `generateChargesForChild` + `getEnrollmentMonths`, so filtering by
  year/month is sufficient.

### Commit `bcab62d` — Multi-currency + custom payment methods
- **Currency picker (EUR / USD / GBP)** on:
  - `src/app/(dashboard)/payments/new/page.tsx`
  - `src/app/(dashboard)/families/[id]/page.tsx` (Add Payment form)
  - `src/app/(dashboard)/payments/import/page.tsx` (Step 1 of the wizard)
  `CURRENCY_OPTIONS` / `CURRENCY_SYMBOLS` already existed in
  `src/lib/payment-utils.ts`. **USD must stay exposed** — user has reminded
  me twice that the `$` option was removed accidentally.
- **Custom payment methods** managed in `src/app/(dashboard)/settings/page.tsx`:
  - Stored under settings key `payment_method_labels` as
    `Record<string, string>` (code → label).
  - Built-in codes (`crc`, `kas`, `bank`, `other`) cannot be removed.
  - New codes must match `^[a-z0-9_]{1,20}$`.
- **`src/lib/use-settings.ts`** — `usePaymentMethods()` hook merges
  built-in labels with the DB-configured ones. Everywhere that renders a
  method should use this hook with a `labels[code] ?? code` fallback.
- **`src/lib/types.ts`** — `PaymentMethod` is now `string` (not a literal
  union); `BUILTIN_PAYMENT_METHODS` lists the canonical codes.
- **`src/app/api/payments/import/route.ts`** builds its allow-list of
  methods from `payment_method_labels` + built-ins, so imports no longer
  force unknown codes to `"other"` on the server side.

---

## Conventions / things easy to forget

- User runs Claude Code on the web — **no local browser**. To preview, deploy
  to Vercel. Never suggest `localhost:3000`.
- Today's date is mocked to 2026-04-15 via `# currentDate` in `CLAUDE.md`.
- Branch rule: develop on `claude/fix-excel-import-dates-GZLaC`; commit & push
  there; do NOT open a PR unless the user explicitly asks.
- `node_modules` is sometimes missing — run `npm install --no-audit --no-fund`
  if `npx tsc --noEmit` complains about missing types.
- Verification before commit: `npx tsc --noEmit` and `npx next lint`.
- Commit message style: short imperative title, blank line, bullet body. No
  Claude trailer needed beyond the one the Bash tool guidance provides.
- `excel-utils.normalizePaymentMethod` still falls back to `"other"` for
  unknown codes at parse time. The server API is authoritative — if the
  user wants custom Excel method codes to pass through verbatim, the
  parser needs to be taught the extra codes (not done yet; no request for it
  so far).

## Open / possible follow-ups

- Let `excel-utils.normalizePaymentMethod` accept a caller-provided set of
  allowed codes so custom settings-defined methods survive from Excel rows
  into the DB (currently only the API accepts them; parser downgrades them).
- No UI for editing labels of built-in methods — Settings can override them
  since `payment_method_labels` is merged *after* built-ins in
  `use-settings.ts`, so this already works for relabeling but not for adding
  aliases to a built-in code.
- Reports page still expects a single currency at the aggregate level; if
  payments in mixed currencies become common, totals need currency grouping.
