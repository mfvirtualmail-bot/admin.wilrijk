# Working Notes — Admin Wilrijk

Persistent cross-session memory. Whenever you touch one of these areas, open
the relevant file first, then update it if the behaviour changes. This is the
single source of truth for "how the app actually works today."

## Index

- [`environment.md`](./environment.md) — user runs Claude Code on the web,
  branch rules, Vercel deploy, env vars, how to verify before committing.
- [`phases.md`](./phases.md) — what each Phase shipped and where it lives.
- [`fx-currency.md`](./fx-currency.md) — multi-currency: FX rate storage
  (settings-table KV), ECB ingestion (daily/90d/2y), 1:1 fallback for missing
  rates, conversion breakdown UI.
- [`email-pdf.md`](./email-pdf.md) — Hebrew+Latin PDF font bundling on
  Vercel, email templates with locale-aware placeholders, SMTP/Gmail setup.
- [`excel.md`](./excel.md) — Excel date parsing (the DD-MM vs MM-DD trap),
  prorated charges, per-cell currency import, export buttons, custom payment
  methods.
- [`gotchas.md`](./gotchas.md) — regressions that have bitten us before and
  the invariants that prevent them. **Read this before making changes that
  touch money, dates, Hebrew text, or Vercel file tracing.**

## When to update

- Any behaviour change a future session would need to re-discover.
- Any "why did we do it this way?" that isn't obvious from the code.
- Any new gotcha you only found by breaking things in production.

Commit message style for doc-only changes: `notes: …`.
