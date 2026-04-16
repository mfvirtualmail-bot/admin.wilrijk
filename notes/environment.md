# Environment & workflow

## Runtime context

- User runs **Claude Code on the web**. There is NO local browser.
  - Never suggest `localhost:3000` — user cannot see it.
  - To preview, the app must be deployed to **Vercel**. That's the only
    visual-feedback loop available.
- `.env.local` exists on the dev server but is gitignored. Do not read or
  echo its contents in chat.
- Today's date is mocked via `# currentDate` in `CLAUDE.md` so every session
  has a stable "today."

## Branch rules

- Develop on `claude/fix-excel-import-dates-GZLaC`.
- Commit and push there.
- **Do not open a PR unless the user explicitly asks.**
- Never push to `main` directly.
- The live Vercel deployment sometimes follows a different branch (e.g. the
  Hebrew-PDF work shipped from `claude/email-templates-pdf-aqXmz`). When the
  user says "it was working," check what their live branch actually is
  before claiming a feature is broken on `main`.

## Verification before commit

```bash
npx tsc --noEmit       # type check
npx next lint          # or: npm run lint
```

Both must be clean. If `node_modules` is missing (happens occasionally on
this dev server), run `npm install --no-audit --no-fund` first.

## Git style

- Short imperative commit title, blank line, bullet body.
- Do not skip hooks (`--no-verify`) or GPG-signing.
- Create new commits, never `--amend` published ones.

## Required env vars

See `.env.local.example`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET` (optional; guards `/api/*/cron` endpoints)
- Gmail SMTP creds for email-statement sending live in the `settings` table,
  not env. See `email-pdf.md`.

## Vercel quirks

- `next.config.mjs` declares `experimental.outputFileTracingIncludes` to
  pull `./fonts/**/*` into every email-related serverless function.
  Without this, the Hebrew TTF gets traced out and PDF generation crashes
  with `ENOENT` on `/var/task`. See `email-pdf.md`.
- Cron jobs are wired via `vercel.json` (`/api/fx/cron` daily, `/api/email/cron`).
