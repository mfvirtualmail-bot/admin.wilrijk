import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getSessionUser, hasModuleAction } from "@/lib/api-auth";
import { getEmailSettings, getEmailTemplate, buildTransporter, sendFamilyStatement } from "@/lib/email-send";
import type { Family } from "@/lib/types";

export const runtime = "nodejs";
// Bulk send can take a while — extend Vercel's function timeout.
export const maxDuration = 300;

/** POST body:
 *  {
 *    familyIds?: string[];     // if omitted, uses filter below
 *    onlyWithBalance?: boolean;
 *    onlyWithEmail?: boolean;
 *    onlyActive?: boolean;
 *  }
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasModuleAction(user.id, user.is_super_admin, "email", "send")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const db = createServerClient();

  const settings = await getEmailSettings(db);
  if (!settings || !settings.smtp_user || !settings.smtp_password) {
    return NextResponse.json({ error: "SMTP credentials not configured" }, { status: 400 });
  }

  // Templates (cached per-locale).
  const templates = {
    en: await getEmailTemplate(db, "en"),
    yi: await getEmailTemplate(db, "yi"),
  };
  if (!templates.en && !templates.yi) {
    return NextResponse.json({ error: "No email templates configured" }, { status: 400 });
  }

  // Resolve the family list.
  let familyIds: string[] = [];
  if (Array.isArray(body.familyIds) && body.familyIds.length > 0) {
    familyIds = body.familyIds;
  } else {
    const q = db.from("families").select("id, email, is_active, language").order("name");
    const { data } = await q;
    const rows = (data ?? []) as Pick<Family, "id" | "email" | "is_active" | "language">[];
    familyIds = rows
      .filter((f) => (body.onlyActive === false ? true : f.is_active))
      .filter((f) => (body.onlyWithEmail === false ? true : !!f.email))
      .map((f) => f.id);
  }

  // Fetch language + email info for all selected families in one query.
  const { data: famRows } = await db
    .from("families")
    .select("id, email, language, is_active")
    .in("id", familyIds);
  const famById = new Map<string, Pick<Family, "id" | "email" | "language" | "is_active">>();
  for (const f of (famRows ?? []) as Pick<Family, "id" | "email" | "language" | "is_active">[]) {
    famById.set(f.id, f);
  }

  // Build one shared transporter for the whole batch.
  const transporter = buildTransporter(settings);

  const results = [];
  for (const id of familyIds) {
    const fam = famById.get(id);
    const loc = (fam?.language as "en" | "yi") ?? "en";
    const template = templates[loc] ?? templates.en ?? templates.yi;
    if (!template) {
      results.push({ ok: false, to: "", familyId: id, subject: "", error: `No template for locale ${loc}` });
      continue;
    }
    const res = await sendFamilyStatement({
      db,
      familyId: id,
      settings,
      template,
      transporter,
      sentBy: user.id,
    });
    results.push(res);
  }

  const okCount = results.filter((r) => r.ok).length;
  return NextResponse.json({
    ok: true,
    total: results.length,
    sent: okCount,
    failed: results.length - okCount,
    results,
  });
}
