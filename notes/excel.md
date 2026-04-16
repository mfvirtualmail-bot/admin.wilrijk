# Excel import & export

The app replaces the gabbai's Excel workflow. Round-tripping data through
Excel (import payments from the old file, export for his records) is a
first-class feature, not a nice-to-have.

## Excel date parsing — DO NOT REGRESS

Symptom when this breaks: imported payments have their day and month
**swapped** (e.g. 3 Feb read as 2 Mar).

The fix is in `src/lib/excel-utils.ts`:

1. Sheets are read with `{ raw: true }` so date cells come back as real
   `Date` objects, not locale-formatted strings.
2. `parseEuropeanDate` accepts `Date | number | string`:
   - `Date` → use `formatLocalISODate(d)` (emits `YYYY-MM-DD` from the
     **local** fields of the Date — no UTC shift).
   - Serial number → interpret as Excel date serial.
   - String → parse assuming DD-MM-YYYY (European convention).
3. Never convert via `d.toISOString()` — that shifts to UTC and can flip
   the day for cells near midnight.

If you ever see "imports look right in preview but wrong after save,"
check that every layer (parser, API, DB insert) passes the date as
`YYYY-MM-DD` string, not a `Date` object that gets re-serialised somewhere.

Historical fix: commit `c75a03b`.

## Prorated charges — don't bill past the current month

Every endpoint that sums "total charged" filters `charges` to rows where
`year*12 + month <= currentYear*12 + currentMonth`. The `charges` table
already bakes in per-student enrollment windows, so year+month filtering
alone is sufficient.

Endpoints that apply this filter:

- `src/app/api/families/[id]/route.ts`
- `src/app/api/dashboard/route.ts` (do NOT revert to `tuition * 12`)
- `src/app/api/reports/route.ts`
- `src/app/api/spreadsheet/route.ts`

## Per-cell currency import

`src/app/api/payments/import/route.ts` and the wizard at
`/payments/import` detect currency symbols in the amount column
(`$`, `£`, `€`, three-letter codes) and store each payment in its
original currency. The wizard also has a Step-1 currency picker for
"everything without an explicit symbol."

## Custom payment methods

Stored in `settings` key `payment_method_labels` as `Record<code, label>`.

- Built-in codes: `crc` (credit card), `kas` (cash), `bank`, `other`.
  These cannot be removed, but their label can be overridden via the
  same map (merge order: built-ins → custom).
- New codes must match `/^[a-z0-9_]{1,20}$/`.
- Editor: `src/app/(dashboard)/settings/page.tsx`.
- Consumer hook: `src/lib/use-settings.ts` → `usePaymentMethods()`.
  Render method names via `labels[code] ?? code`.
- Type: `src/lib/types.ts` — `PaymentMethod` is `string`, not a literal
  union. `BUILTIN_PAYMENT_METHODS` lists the canonical codes.

### Known parser limitation

`excel-utils.normalizePaymentMethod` still downgrades unknown method
codes to `"other"` at parse time. The import API itself is authoritative
and accepts custom codes, but if the user wants Excel rows with a custom
code to pass through verbatim, the parser needs the extra codes (not
done; no user request yet).

## Excel export

Export buttons on Payments, Families, Students pages call
`src/lib/export-utils.ts`. All exports include the original currency
column — **do not collapse to EUR-only in exports**. The gabbai has
asked for the raw numbers as entered.

## Related commits

- `c75a03b` — Excel dates & prorated charges
- `bcab62d` — Multi-currency + custom payment methods
- `da1fc2d` — Phase 5 export buttons
- `60477c8` — Phase 6 import per-cell currency + preserve custom methods
