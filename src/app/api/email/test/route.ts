import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getSessionUser, hasModuleAction } from "@/lib/api-auth";
import { getEmailSettings, getEmailTemplate, sendFamilyStatement } from "@/lib/email-send";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST body: { familyId: string; toAddress: string }
 *  Sends the rendered email + PDF to `toAddress` using `familyId`'s data.
 *  Useful for the admin to preview what a real send looks like. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasModuleAction(user.id, user.is_super_admin, "email", "send")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const familyId: string | undefined = body.familyId;
  const toAddress: string | undefined = body.toAddress;

  if (!familyId || !toAddress) {
    return NextResponse.json({ error: "familyId and toAddress are required" }, { status: 400 });
  }

  const db = createServerClient();
  const settings = await getEmailSettings(db);
  if (!settings?.smtp_user || !settings.smtp_password) {
    return NextResponse.json({ error: "SMTP credentials not configured" }, { status: 400 });
  }

  const template = await getEmailTemplate(db);
  if (!template) return NextResponse.json({ error: "No email template configured" }, { status: 400 });

  const res = await sendFamilyStatement({
    db,
    familyId,
    settings,
    template,
    overrideTo: toAddress,
    sentBy: user.id,
    isTest: true,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });
  return NextResponse.json({ ok: true, to: res.to, subject: res.subject });
}
