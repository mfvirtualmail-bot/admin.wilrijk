# System Status — Admin Wilrijk

Exhaustive, honest audit of every feature in the deployed app
(`admin-wilrijk.vercel.app`, branch `claude/fix-excel-import-dates-GZLaC`
after merging `origin/main`).

> **Scope note.** My earlier branch was behind main — main had already gained
> emails/PDF/cron features built in parallel branches. Those are now merged in.
> Everything described below reflects the real, deployed state, not an earlier
> snapshot.

---

## 1. What works right now — by page

### Login — `/login`
- One form: username + password → **Log In** button.

### Dashboard — `/`
- Four stat cards: Total Families, Total Students, Total Received, Total Outstanding.
- Recent Payments table, quick links to "Add Family" / "Add Payment" / "View Spreadsheet" / "View Families".
- **Currency is hardcoded to € here** (`formatEur` at lines 75, 84, 129, 130, 155).

### Spreadsheet — `/spreadsheet`
- AG Grid of Families × academic-year months.
- Columns: Family | for each month [Date, Method, €] | Summary [Charged, Paid, Balance].
- **Editable inline** for super-admin / `spreadsheet:edit` perm (date, method, amount, notes).
- **"Export Excel" button exists** (`handleExport` at `src/app/(dashboard)/spreadsheet/page.tsx:312`). Exports the same grid to `.xlsx`.
- **Column header and every amount cell say `€` hardcoded.** `/api/spreadsheet/cell` does **not** accept a `currency` field, so edits from this page are always saved as EUR.

### Families list — `/families`
- Columns: Family Name, Father, City, Phone, Email, Status, Actions.
- Search, sort, row checkboxes, bulk-delete, **+ Add Family**, **Import from Excel**.
- Per-row: Delete only (super-admin).
- **No Edit button on a family row** here — you open the detail page to edit.
- **No CSV/Excel export button.**

### Family detail — `/families/[id]`
Screenshot reference: `Ball (Josef Chaim)`.
- Summary cards: Total Charged, Total Paid, Amount Due (all display correctly in EUR/USD/GBP).
- Family info card actions: **✉ Send statement**, **Edit**, **Delete Family**.
- Students section: **+ Add Student**; per student row: **Edit**, **Remove**.
- Payments section: **+ Add Payment**; per payment row: **Delete only — no Edit button**.
- Currency **is** respected in display here.

### Family import wizard — `/families/import`
- 4-step wizard (upload → map → preview → import). Working.

### Students list — `/children`
- Columns: Student, Family, Class, Monthly Tuition, Status, Actions (Delete).
- Bulk delete. No Edit here (editing happens from family detail).
- **Monthly-tuition total + each row amount are hardcoded `formatEur`** (`src/app/(dashboard)/children/page.tsx:127, 191`) — shows € even if the student's tuition currency is £/$.

### Payments list — `/payments`
- Columns: Date, Family, Method, Period, Notes, Amount, Actions.
- Filter by method, bulk delete, **+ New Payment**, **Import from Excel**.
- Per-row: Delete only — **no Edit button** anywhere in the app.
- Amount column uses the payment's own currency correctly.

### New payment — `/payments/new`
- Form: Family, Amount + **currency selector (EUR/USD/GBP)**, Date, Method dropdown (built-ins + custom codes), Notes, optional month allocation.

### Payment import wizard — `/payments/import`
- 4-step wizard. Step 1 now has Academic Year **and** currency selector. Preview shows symbol + configured method labels. API accepts custom method codes.
- **But** `ImportPayment` in `src/lib/excel-utils.ts:485` has no per-row `currency` field; the wizard applies one currency to the whole file.
- **And** `normalizePaymentMethod` in `excel-utils.ts:330` still downgrades unknown codes to `"other"` at parse time — custom Settings method codes appearing in Excel cells are lost.

### Reports — `/reports`
- Summary cards (Total Charged/Collected/Outstanding/Rate), collection-progress bar, monthly table, payment-methods breakdown, outstanding-families list, bar chart.
- **Every number is formatted as €** — `formatEur` at lines 89, 91, 114, 115, 140, 141, 143, 181, 213. Mixed-currency data is silently added together.
- Uses a **hardcoded `METHOD_NAMES` map** (lines 35-40): custom method codes configured in Settings are rendered as their raw code instead of the configured label.
- **No export / download button.**

### Emails — `/emails` (visible only if `email:send` perm)
- Bulk send UI: select families, filter by active / has-email / has-balance, per-family preview (HTML + PDF iframe), **Send to N families**, **Send test**.
- Preview comes from `GET /api/email/preview`; PDF from `GET /api/email/pdf` (binary stream).
- Bulk send → `POST /api/email/send`.
- Cron: `GET /api/email/cron` at `0 8 1 * *` sends monthly to all active families with email + balance > 0 (protected by `CRON_SECRET`).

### Admin → Users — `/admin/users`
- List + **+ New User**. Per row: Edit, Delete (super-admin).
- `/admin/users/[id]` gives a permission matrix per module × action.

### Admin → Email Settings — `/settings/email`
- SMTP host/port/secure/user/password, From name/email, reply-to, bcc-admin, org name/address/logo, payment instructions.
- **Test SMTP** button calls `/api/email/verify`.

### Admin → Email Templates — `/settings/email-templates`
- Edit the HTML/plaintext/subject templates used in statements.

### Settings — `/settings`
- School name, **Payment Method Labels** (add/remove custom codes, built-ins locked), **Default Payment Method**.
- Audit log viewer (filter by table, paginated 20/page).

### Profile — `/profile`
- Display name, language (EN/NL/YI), new password.

---

## 2. Requested features — done vs not done

### You asked (Batch 1, Excel import bug)
| # | Request | Done? | Evidence |
|---|---------|-------|----------|
| 1 | Fix date swap on Excel import (DD-MM-YY was being parsed MM-DD) | ✅ | `c75a03b` — `excel-utils.ts` now reads with `raw: true`, `parseEuropeanDate` takes `Date \| number \| string`. |
| 2 | "Total Charged" should count only months already passed and enrolled | ✅ | `c75a03b` — filter on `year*12+month <= currentKey` in `/api/families/[id]`, `/api/dashboard`, `/api/reports`, `/api/spreadsheet`. |
| 3 | Fix it "in all places in the system" | ⚠️ Partial | All **backend** totals fixed. **But** any page still using `formatEur(...)` displays only EUR — see list in §3. |

### You asked (Batch 2, currency + custom methods)
| # | Request | Done? | Evidence |
|---|---------|-------|----------|
| 4 | Option to change payment currency EUR / £ | ✅ on 3 forms | Currency picker on `/payments/new`, `/families/[id]` Add-Payment form, `/payments/import` Step 1. |
| 5 | Also include **$ (USD)** — you reminded me twice | ✅ | All selectors iterate `CURRENCY_OPTIONS` which lists EUR, USD, GBP. |
| 6 | Add new payment method types in Settings | ✅ | `/settings` — add/remove custom codes (regex `^[a-z0-9_]{1,20}$`); built-ins stay locked. `payment_method_labels` in `settings` table. |
| 7 | Save this conversation | ✅ | `NOTES.md` committed in `7a8d299`; this file (`SYSTEM_STATUS.md`) is the extended version. |

### You asked (this conversation)
| # | Request | Done? |
|---|---------|-------|
| 8 | "Where can I edit payments? Change EUR → GBP on an existing record." | ❌ **Not implemented** — no edit UI or API exists. I proposed it but did not build it. |
| 9 | "Write down clearly what works / what you forgot / what I requested." | ✅ This file. |

---

## 3. Things I forgot or got wrong — **need to fix**

Listed in priority order. Each one is self-contained.

### A. Editing existing payments — missing entirely
- **Symptom:** No `Edit` button on `/payments` rows or `/families/[id]` payment rows. Only `Delete`.
- **Why it matters:** To fix a wrong currency, date, method, amount, or month allocation you currently have to delete and re-enter.
- **Fix plan:**
  1. Add `PATCH /api/payments/[id]` (mirror POST validation, require `payments:edit`).
  2. Build `/payments/[id]/edit` as a copy of `/payments/new` pre-filled from `GET /api/payments` filtered by id.
  3. Add **Edit** link next to **Delete** on both the `/payments` list and the family-detail payments table.

### B. Currency formatting ignored on 4 pages
Even though payments store currency correctly, these pages always render €:
- `src/app/(dashboard)/page.tsx` (Dashboard) lines 75, 84, 129, 130, 155
- `src/app/(dashboard)/reports/page.tsx` lines 89, 91, 114, 115, 140, 141, 143, 181, 213
- `src/app/(dashboard)/children/page.tsx` lines 127, 191
- `src/app/(dashboard)/spreadsheet/page.tsx` cell and header formatters (several lines)
- **Fix:** replace `formatEur` with `formatCurrency(amount, row.currency)` and, for mixed-currency aggregates, either group totals by currency or show "mixed" and break out by currency.

### C. Spreadsheet inline edits drop currency
- `POST/PUT /api/spreadsheet/cell` does not accept a `currency` field — edits from the grid always save as EUR.
- **Fix:** accept `currency` in the request body and persist it. Expose a currency column or per-cell currency hint in the grid.

### D. Reports totals mix currencies
- `/api/reports` returns single `totalPaid` / `totalCharged` / `totalDue` numbers, summing €, $, £ together.
- **Fix:** return totals grouped by currency `{EUR: {...}, USD: {...}, GBP: {...}}`, and render separate cards (or a tab) per currency.

### E. Reports payment-methods list shows raw codes for custom methods
- `/reports` has a local `METHOD_NAMES` at lines 35-40 (crc/kas/bank/other only).
- **Fix:** use the `usePaymentMethods()` hook like the other pages — `methodLabels[code] ?? code`.

### F. Excel import does not keep per-row currency
- `ImportPayment` interface lacks a `currency` field; the wizard applies one currency to the whole sheet.
- **Fix:** teach `processPaymentRows` to detect `€ / $ / £` prefixes in amount cells (or add a currency column mapping) and set per-row `currency`. Pass through to `/api/payments/import`.

### G. Excel importer downgrades custom methods to "other"
- `normalizePaymentMethod` hard-codes the four built-ins.
- **Fix:** accept a caller-provided `allowedMethods` set (fetched from Settings) so custom codes that appear in Excel survive.

### H. `/api/payments` POST defaults to EUR silently
- If the client forgets `currency`, the payment is stored as EUR with no warning.
- **Fix:** either reject the request or log it; defaulting without signalling is a footgun in a multi-currency world.

### I. "Export option — you removed it" — verified, I did **not** remove anything
- Checked git history: no export features were deleted by any of my commits.
- **Currently exists:** `Export Excel` on `/spreadsheet` (still there, line 364).
- **Never existed:** CSV/Excel export on `/payments`, `/families`, `/children`, `/reports`.
- If you want export added to those pages, it's a straightforward add — let me know which page(s).

---

## 4. Things I want you to confirm before I touch them

Before I start fixing §3, please confirm or adjust these decisions so I don't misread again:

1. **Payment edit UI** — full page (`/payments/[id]/edit`) or inline modal? I'll default to full page because it's safer and matches `/payments/new`.
2. **Multi-currency totals** — on Reports and Dashboard, do you want (a) one tab per currency, or (b) a single dominant currency with a note, or (c) auto-convert to EUR using a fixed rate stored in Settings?
3. **Export** — which pages need Export buttons? (spreadsheet already has one). My guess: Payments list + Families list + Reports → CSV.
4. **Excel import currency detection** — OK to detect `£ / $ / €` prefixes per amount cell and override the wizard's default currency when found?

---

## 5. Known conventions (so the next Claude session doesn't forget)

- Web-only environment — **no localhost**; preview on Vercel.
- Branch rule: develop on `claude/fix-excel-import-dates-GZLaC`; merge main in before each audit; don't open PRs unless asked.
- Verify with `npx tsc --noEmit` and `npx next lint`.
- Commit style: short imperative title, bullet body, no emojis.
- Currency symbols: `CURRENCY_SYMBOLS = { EUR: "€", USD: "$", GBP: "£" }` in `src/lib/payment-utils.ts:22`.
- `PaymentMethod` is `string` (not a literal union); built-ins live in `BUILTIN_PAYMENT_METHODS`.
- Custom method codes stored under settings key `payment_method_labels`.
- Email settings row is always id=1.
