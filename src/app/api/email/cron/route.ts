import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getEmailSettings, getEmailTemplate, buildTransporter, sendFamilyStatement } from "@/lib/email-send";
import type { Family } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Vercel Cron entrypoint. Wire up in vercel.json:
 *    { "crons": [{ "path": "/api/email/cron", "schedule": "0 8 1 * *" }] }
 *  Sends statements to every active family that has an email address and a
 *  non-zero balance. Protected by CRON_SECRET if set — Vercel also sets
 *  `x-vercel-cron-signature`, but we check a shared secret for simplicity. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get("authorization") ?? "";
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const db = createServerClient();
  const settings = await getEmailSettings(db);
  if (!settings?.smtp_user || !settings.smtp_password) {
    return NextResponse.json({ error: "SMTP credentials not configured" }, { status: 400 });
  }

  const templates = {
    en: await getEmailTemplate(db, "en"),
    yi: await getEmailTemplate(db, "yi"),
  };

  const { data } = await db
    .from("families")
    .select("id, email, language, is_active")
    .eq("is_active", true);
  const rows = ((data ?? []) as Pick<Family, "id" | "email" | "language" | "is_active">[])
    .filter((f) => !!f.email);

  const transporter = buildTransporter(settings);
  const results = [];
  for (const f of rows) {
    const loc = (f.language as "en" | "yi") ?? "en";
    const template = templates[loc] ?? templates.en ?? templates.yi;
    if (!template) continue;
    const r = await sendFamilyStatement({
      db,
      familyId: f.id,
      settings,
      template,
      transporter,
      sentBy: null,
    });
    results.push(r);
  }

  const sent = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: true, sent, failed: results.length - sent, total: results.length });
}
