# Admin Wilrijk — Tuition Management System

## Project Overview
Tuition fee management system replacing Excel-based tracking for Beit Midrash Wilrijk.
Critical requirement: accessible UI for a 93-year-old gabbai who manages finances via spreadsheet.
Currency: EUR.

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
    supabase.ts     # Supabase client (singleton pattern, getSupabase() / createServerClient())
    auth.ts         # Password hashing, session CRUD, permission checks
    auth-context.tsx # React context: AuthProvider + useAuth() hook
    i18n.ts         # Translation: t(), isRTL(), getDirection()
    types.ts        # TypeScript interfaces for all data models
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
- **payments**: family-level payments (date, method: crc/kas/bank/other, amount, month, year)
- **settings**: key-value config store
- **audit_log**: JSONB change tracking

## Key Design Decisions
- Payments are per family, not per child. Charges are per child but balance rolls up to family.
- Payment methods from Excel: `crc` = credit card, `kas` = cash
- Academic year runs September (month 9) through July (month 7)
- No fixed roles — Super Admin assigns granular permissions via checkbox matrix
- i18n: per-user language stored in DB, persists across sessions

## Implementation Phases
- **Phase 0** (Foundation): Project scaffolding, auth, layout, shell pages -- DONE
- **Phase 1** (Security): User management UI, permission matrix
- **Phase 2** (Core Data): CRUD for families, children, charges, payments
- **Phase 3** (UX Priority): AG Grid spreadsheet page
- **Phase 4** (Usability): Full i18n + RTL
- **Phase 5** (Analytics): Reports + data export
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
