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

  const templateId = typeof body.templateId === "string" ? body.templateId : null;
  const template = await getEmailTemplate(db, templateId);
  if (!template) {
    return NextResponse.json({ error: "No email template configured" }, { status: 400 });
  }

  // Resolve the family list.
  let familyIds: string[] = [];
  if (Array.isArray(body.familyIds) && body.familyIds.length > 0) {
    familyIds = body.familyIds;
  } else {
    const q = db.from("families").select("id, email, is_active").order("name");
    const { data } = await q;
    const rows = (data ?? []) as Pick<Family, "id" | "email" | "is_active">[];
    familyIds = rows
      .filter((f) => (body.onlyActive === false ? true : f.is_active))
      .filter((f) => (body.onlyWithEmail === false ? true : !!f.email))
      .map((f) => f.id);
  }

  // Build one shared transporter for the whole batch.
  const transporter = buildTransporter(settings);

  const results = [];
  for (const id of familyIds) {
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
