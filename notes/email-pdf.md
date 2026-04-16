# Email statements & PDF generation

Parents receive monthly tuition statements as a PDF email attachment. The
PDF must render Hebrew names (family + student) alongside Latin text in the
same document — the PDF font bundling is the fragile part.

## PDF font bundling on Vercel — DO NOT REGRESS

Symptoms when this breaks:

- Runtime error: `ENOENT: no such file or directory, open
  '/var/task/.../fonts/NotoSansHebrew-Regular.ttf'`.
- OR: English PDF renders fine but Hebrew names appear as mojibake
  (□□□) — this means `pdf-statement.tsx` silently fell back to Helvetica.

The only arrangement that works on Vercel's serverless runtime:

1. **Font format must be TTF**, committed at
   `./fonts/NotoSansHebrew-Regular.ttf` and `./fonts/NotoSansHebrew-Bold.ttf`.
   `@fontsource/noto-sans-hebrew` `.woff` subsets DO NOT WORK — Vercel's
   file-tracer strips them because nothing statically imports them.

2. **`next.config.mjs`** must include:

   ```js
   experimental: {
     outputFileTracingIncludes: {
       "/api/email/send":     ["./fonts/**/*"],
       "/api/email/preview":  ["./fonts/**/*"],
       "/api/email/pdf/**":   ["./fonts/**/*"],
       "/api/email/test":     ["./fonts/**/*"],
       // …any other route that calls pdf-statement.tsx
     },
   }
   ```

   Without this, even the TTF gets traced out.

3. **`src/lib/pdf-statement.tsx`** loads the TTF from
   `process.cwd() + "/fonts"` via `fs.readFileSync` and **throws** if
   missing. Never silently fall back to Helvetica — that hides the config
   drift and produces mojibake that's easy to miss in review.

Historical fix: commit `661610e` on branch
`claude/email-templates-pdf-aqXmz`, cherry-picked into this branch as
commit `44a2486`. If this breaks again, check those commits first.

### "It was working already"

If the user says the PDF feature was working on their live deploy, believe
them — their Vercel project may be building from a different branch (e.g.
`claude/email-templates-pdf-aqXmz`) even if `main` is missing the fix.
Check the Vercel project's "Production branch" setting before claiming a
feature is broken.

## Email templates

Stored in `settings` table under key `email_templates` as a per-locale
object. Two locales: `en` and `yi`.

- Subject + body are plain text with `{{placeholder}}` tokens.
- Blank lines → paragraph breaks in the rendered HTML/PDF.
- Editor: `src/app/(dashboard)/settings/email-templates/page.tsx`.
- Renderer: `src/lib/email-render.ts` exports `TEMPLATE_PLACEHOLDERS` and
  the merge function.

### Placeholders

Each placeholder is tagged `locale: "en" | "yi" | "both"`. The palette in
the editor filters by the currently-selected tab, so the Yiddish template
shows Hebrew-name fields and the English template shows Latin-name
fields. "Both"-tagged placeholders (balance, dates, org name) are always
visible.

Hebrew-specific placeholders:

- `{{hebrew_family_name}}`
- `{{hebrew_father_name}}`
- `{{hebrew_contact_name}}`
- `{{hebrew_children_names}}`

Latin-specific:

- `{{family_name}}`, `{{father_name}}`, `{{contact_name}}`,
  `{{children_names}}`.

**`children_names` uses first names only** to avoid duplicating the
surname (e.g. "Levi, Sarah, David" rather than
"Levi Goldberg, Sarah Goldberg, David Goldberg"). Same for
`hebrew_children_names`.

## SMTP / sending

- Credentials live in `settings` key `smtp_config` (not env). Managed at
  `/settings` → Email tab.
- Gmail app passwords: `src/app/api/email/settings/route.ts` strips
  whitespace from the pasted password (Gmail inserts spaces in the
  16-character app-password display that cause silent auth failures).
- `src/app/api/email/verify/route.ts` is the "Test SMTP" button —
  attempts an auth handshake and surfaces the error.
- Nightly cron at `/api/email/cron` sends queued statements.

## Related files

- `src/lib/pdf-statement.tsx` — `@react-pdf/renderer` document definition.
- `src/lib/statement-data.ts` — builds the data blob (charges, payments,
  balance) that both the PDF and the email HTML consume.
- `src/lib/email-render.ts` — placeholder merge, HTML/text rendering.
- `src/lib/email-send.ts` — nodemailer wrapper.
- `src/app/api/email/` — routes for preview, send, test, log, cron.
