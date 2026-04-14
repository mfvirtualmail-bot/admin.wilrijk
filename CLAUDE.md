# Admin Wilrijk — Tuition Management System

## IMPORTANT: Environment Note
User runs **Claude Code on the web**. There is NO local browser access.
- Never suggest opening `localhost:3000` — the user cannot see it
- To preview the app, deploy to **Vercel** (the only option)
- `.env.local` exists on this server but is gitignored

## Project Overview
Tuition fee management system replacing Excel-based tracking for Beit Midrash Wilrijk.
Critical requirement: accessible UI for a 93-year-old gabbai who manages finances via spreadsheet.
Currency: EUR (but multi-currency import supported — see below).

## Tech Stack
- **Framework**: Next.js 14 (App Router), TypeScript, React 18
- **Styling**: Tailwind CSS
- **Spreadsheet**: AG Grid Community
- **Backend**: Supabase (PostgreSQL)
- **Auth**: Custom cookie-based sessions, PBKDF2/SHA-512 password hashing
- **Deployment**: Vercel with branch preview support

## Project Structure
```
src/
  app/
    layout.tsx                  # Root layout
    login/page.tsx              # Login page (public)
    (dashboard)/
      layout.tsx                # Protected layout with Sidebar
      page.tsx                  # Dashboard home
      spreadsheet/page.tsx      # AG Grid tuition interface (Phase 3)
      families/page.tsx         # Family list (Phase 2)
      families/[id]/page.tsx    # Family detail (Phase 2)
      children/page.tsx         # Student roster (Phase 2)
      payments/page.tsx         # Payment history (Phase 2)
      reports/page.tsx          # Analytics (Phase 5)
      admin/users/page.tsx      # User management (Phase 1)
      admin/users/[id]/page.tsx # User detail/permissions (Phase 1)
      settings/page.tsx         # System settings (Phase 6)
      profile/page.tsx          # User profile
    api/auth/
      login/route.ts            # POST: authenticate user
      logout/route.ts           # POST: destroy session
      me/route.ts               # GET: current user + permissions
  lib/
    supabase.ts       # Supabase client (singleton pattern, getSupabase() / createServerClient())
    auth.ts           # Password hashing, session CRUD, permission checks
    auth-context.tsx  # React context: AuthProvider + useAuth() hook
    i18n.ts           # Translation: t(), isRTL(), getDirection()
    types.ts          # TypeScript interfaces for all data models
    payment-utils.ts  # METHOD_LABELS, METHOD_COLORS, formatCurrency, etc.
    hebrew-date.ts    # Hebrew calendar utils: hebrewMonthLabel, elapsedAcademicMonths, etc.
    charge-utils.ts   # generateChargesForChild, regenerateChargesForChild
    family-utils.ts   # familyDisplayName, getEnrollmentMonths
    excel-utils.ts    # parseEuropeanDate, parseExcelFile, processPaymentRows
    export-utils.ts   # exportToExcel (shared xlsx export helper)
  components/
    Sidebar.tsx     # Navigation sidebar with conditional admin items
    Header.tsx      # Page header with title + user info
  locales/
    en.json         # English translations
    nl.json         # Dutch translations
    yi.json         # Yiddish translations (RTL)
  middleware.ts     # Auth middleware: redirects unauthenticated to /login
supabase/
  schema.sql        # Full PostgreSQL schema for all tables
```

## Database Tables
- **users**: auth, preferences, super_admin flag
- **sessions**: token-based with 7-day expiry
- **user_permissions**: module-action pairs (families/children/charges/payments/spreadsheet/reports/users/settings x view/add/edit/delete)
- **families**: parent/family records with contact info
- **children**: students linked to families, monthly_tuition amount
- **charges**: monthly per-child tuition entries (month, year, amount)
- **payments**: family-level payments (date, method: crc/kas/bank/jj/other, amount, month, year, currency)
- **settings**: key-value config store
- **audit_log**: JSONB change tracking

## Key Design Decisions
- Payments are per family, not per child. Charges are per child but balance rolls up to family.
- Payment methods: `crc` = credit card, `kas` = cash, `bank` = bank transfer, `jj` = JJ, `other` = other
- Academic year runs Elul (≈ Sep, month 9) through Av (≈ Aug, month 8)
- **Tuition billing rule**: tuition accrues ONE MONTH AT A TIME on Rosh Chodesh (1st of each Hebrew month). Only elapsed Hebrew months are counted as debt. Future months are NOT shown as unpaid.
- Hebrew calendar is computed using real `Intl.DateTimeFormat('en-u-ca-hebrew')` — NOT Gregorian approximation.
- No fixed roles — Super Admin assigns granular permissions via checkbox matrix
- i18n: per-user language stored in DB, persists across sessions
- Enrollment end date is OPTIONAL (null = ongoing, enrolled through end of current academic year)

## Spreadsheet — Charging Logic (IMPORTANT)
The spreadsheet does NOT use the `charges` table. It computes debt on-the-fly:

```
elapsedMonths = elapsedAcademicMonths(academicYear)  // uses real Hebrew calendar
for each month column (index 0..11):
  if index < elapsedMonths AND child is enrolled in this month:
    totalCharged += child.monthly_tuition
```

- **Red cell** = elapsed month, no payment recorded
- **Yellow cell** = elapsed month, partial payment (amount < charge)
- **Green cell** = elapsed month, full payment (amount >= charge)
- **Neutral/grey cell** = future Hebrew month (not yet due — NOT a debt)
- **Light blue cell** = future month but payment already entered (pre-paid)

Enrollment window per child:
- `enrollment_start_month/year` (default Sep of academic year)
- `enrollment_end_month/year` — **nullable** (null = ongoing, no end date)
- If null end, child is treated as enrolled through academic year end (Av)

## Payment Methods (complete list)
```ts
export type PaymentMethod = "crc" | "kas" | "bank" | "jj" | "other";
```
- All five are valid values in the database (no CHECK constraint, any string accepted)
- `jj` maps to `jj` in Excel imports (NOT to `other`)
- Colors: crc=blue, kas=green, bank=purple, jj=amber, other=grey

## Excel Import — Date Parsing
Date format expected: **DD-MM-YY** (European).
`parseEuropeanDate()` in `src/lib/excel-utils.ts`:
- Handles JS `Date` objects (xlsx returns these with `cellDates: true`)
- Handles DD-MM-YY, DD-MM-YYYY, DD/MM/YYYY
- If DD-MM fails (month > 12), falls back to MM-DD-YY
- **If date cannot be parsed**: uses the 1st of the payment's allocated month/year (NOT today's date)
- This prevents the "wrong date" bug where unparseable Excel dates were saved as today

## Export Buttons
All list pages have a green "Export Excel" button that exports the current filtered view:
- `/families` → `families-YYYY-MM-DD.xlsx`
- `/children` → `students-YYYY-MM-DD.xlsx`
- `/payments` → `payments-YYYY-MM-DD.xlsx`
- `/spreadsheet` → `tuition-YYYY-YYYY.xlsx` (already had export)
Shared helper: `src/lib/export-utils.ts` → `exportToExcel(filename, sheetName, headers, rows)`

## Spreadsheet Header Stats
The toolbar shows: `[Hebrew year label] | X families | Y students | Total paid: €... | Total due: €...`
- Student count comes from `/api/spreadsheet` → `totalStudents` field
- `totalDue` = sum of `Math.max(0, balance)` per family (positive balances only)

## Hebrew Calendar Utilities (src/lib/hebrew-date.ts)
Key functions:
- `hebrewMonthLabel(gregorianMonth, gregorianYear)` → Hebrew month name + year label
- `academicYearLabel(gregorianStartYear)` → "שנת הלימודים תשפ״ו"
- `elapsedAcademicMonths(academicYear, now?)` → number 0–12 of Hebrew months started
- `currentHebrewMonth(now?)` → `{ index: 0..11, hebrewYear: 5786 }` using Intl

Academic year index mapping (Elul=0 through Av=11):
```
Elul=0  Tishri=1  Heshvan=2  Kislev=3  Tevet=4  Shevat=5
Adar=6  Nisan=7   Iyar=8     Sivan=9   Tamuz=10  Av=11
```

## Enrollment End Date — OPTIONAL
`enrollment_end_month` and `enrollment_end_year` on `children` are nullable.
- UI shows "— ללא תאריך סיום —" as the first option (empty value → null)
- null means enrolled ongoing through end of current academic year
- Display in family detail shows "ללא תאריך סיום" when null
- `getEnrollmentMonths()` defaults null end to Aug of baseYear+1 (charge generation)
- Spreadsheet API defaults null end to academic index 11 (Av)

## Implementation Phases
- **Phase 0** (Foundation): Project scaffolding, auth, layout, shell pages -- DONE
- **Phase 1** (Security): User management UI, permission matrix -- DONE
- **Phase 2** (Core Data): CRUD for families, children, charges, payments -- DONE
- **Phase 3** (UX Priority): AG Grid spreadsheet page -- DONE
- **Phase 4** (Usability): Full i18n + RTL
- **Phase 5** (Analytics): Reports + data export -- partial (export buttons added)
- **Phase 6** (Polish): Settings, audit log UI, bulk import

## Commands
```bash
npm run dev      # Start dev server (localhost:3000)
npm run build    # Production build
npm run lint     # ESLint
```

## Environment Variables
See `.env.local.example` for required Supabase keys:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## Full Plan Reference
https://github.com/mfvirtualmail-bot/beit-midrash-finance/blob/claude/admin-wilrijk-continue-2ooP3/ADMIN_WILRIJK_PLAN.md

---

## Session History — Decisions & Changes Made

### Session (2026-04-14) — Multi-currency import, JJ method, date fix, exports, Hebrew billing

#### Changes shipped (branch: `claude/add-currency-import-support-2jl48`):

**1. JJ payment method**
- Added `"jj"` to `PaymentMethod` type (`src/lib/types.ts`)
- Added `METHOD_LABELS["jj"] = "JJ"` and amber color badge (`src/lib/payment-utils.ts`)
- `METHOD_MAP["jj"] = "jj"` in `src/lib/excel-utils.ts` (was incorrectly `"other"`)
- Import API whitelist updated to include `"jj"`
- Spreadsheet cell: `jj` shown in amber (#b45309)

**2. Student count on Spreadsheet toolbar**
- `/api/spreadsheet` now returns `totalStudents` (total active children)
- Toolbar shows: `X families · Y students · Total paid: … · Total due: …`

**3. Excel import — date parsing fix**
- `parseEuropeanDate()` now handles JS `Date` objects (xlsx `cellDates: true`)
- When date still unparseable: use `YYYY-MM-01` of the payment's month/year (NOT today)
- Prevents old bug where unparseable dates defaulted to today's date

**4. Export buttons on all list pages**
- New `src/lib/export-utils.ts` helper
- Green "Export Excel" button on `/families`, `/children`, `/payments`
- Exports respect current search/filter

**5. Hebrew month billing (Rosh Chodesh rule)**
- Tuition now accrues one month at a time, on the 1st of each Hebrew month
- New `elapsedAcademicMonths(academicYear)` in `src/lib/hebrew-date.ts` uses real Hebrew calendar via `Intl.DateTimeFormat('en-u-ca-hebrew')`
- Spreadsheet API: charges only for elapsed months × per-child enrollment window
- Future months: neutral cell color (not red "unpaid")
- Pre-paid future months: light blue

**6. Optional enrollment end date**
- `enrollment_end_month/year` can now be null = "ongoing / no end date"
- UI dropdown: first option is "— ללא תאריך סיום —"
- Default for new students changed from Aug of next year → blank (ongoing)
- Display shows "ללא תאריך סיום" when null
