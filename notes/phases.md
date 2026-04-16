# Implementation phases

Status as of 2026-04-16. See individual topic files for the gory details.

## Phase 0 — Foundation (DONE)

- Next.js 14 App Router scaffold, Tailwind, Supabase client
  (`src/lib/supabase.ts` — `getSupabase()` / `createServerClient()`).
- Cookie-session auth, PBKDF2/SHA-512 password hashing (`src/lib/auth.ts`).
- Sidebar + Header shell, `AuthProvider` / `useAuth()`.
- i18n (`src/lib/i18n.ts`): `t()`, `isRTL()`, `getDirection()` with
  `en` / `nl` / `yi` locales.
- Middleware redirect to `/login` for unauthenticated users.

## Phase 1 — Security (DONE)

- Super-admin-managed user page at `/admin/users`.
- Permission matrix UI at `/admin/users/[id]` — module × action checkboxes
  (families, children, charges, payments, spreadsheet, reports, users,
  settings × view/add/edit/delete).
- `getUserPermissions(userId)` + `is_super_admin` flag gate every API route.

## Phase 2 — Core data CRUD (DONE)

- `families`, `children` (renamed to students in UI but DB is still
  `children`), `charges`, `payments` endpoints.
- `charges` are per-student per-month; `payments` are per-family.
- Hebrew name fields on families and students.
- Enrollment periods per child (`generateChargesForChild` +
  `getEnrollmentMonths` bake windows into the `charges` table).

## Phase 3 — AG Grid spreadsheet (DONE)

- `/spreadsheet` page: single screen matching the Excel file the gabbai used.
- Payment editing: PATCH endpoint + per-row edit link.

## Phase 4 — i18n + RTL (DONE)

- Yiddish locale with full RTL, Hebrew name rendering, custom Noto Sans
  Hebrew font for PDF statements.

## Phase 5 — Reports + export (DONE)

- Dashboard with prorated totals.
- Excel export buttons on Payments, Families, Students.
- EUR-converted totals with a "Conversion breakdown" accordion
  (`src/components/ConversionBreakdown.tsx`).

## Phase 6 — Polish (mostly DONE)

- Settings page with Advanced tab (FX rate CRUD).
- Excel import wizard with per-cell currency detection and preservation of
  custom payment method codes.
- Email statement system: PDF generation via `@react-pdf/renderer`, SMTP
  send via Gmail, locale-aware templates.
- Audit log (`audit_log` JSONB).

## Known open items

- Reports currency grouping (single-currency assumption at aggregate level).
- Parser still downgrades unknown Excel payment method codes — see
  `excel.md`.
