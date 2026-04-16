import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getSessionUser, hasModuleAction } from "@/lib/api-auth";
import { buildFamilyStatement } from "@/lib/statement-data";
import { getEmailSettings, getEmailTemplate } from "@/lib/email-send";
import { renderTemplate, renderHtmlEmail, buildTemplateVars } from "@/lib/email-render";

/** Returns the rendered subject + HTML body + text body + balance for a
 * family, ready for the preview pane. Does NOT generate the PDF (that is
 * fetched separately via /api/email/pdf for efficiency). */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasModuleAction(user.id, user.is_super_admin, "email", "send")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const familyId = req.nextUrl.searchParams.get("familyId");
  if (!familyId) return NextResponse.json({ error: "familyId required" }, { status: 400 });

  const db = createServerClient();
  const data = await buildFamilyStatement(db, familyId);
  if (!data) return NextResponse.json({ error: "Family not found" }, { status: 404 });

  const settings = await getEmailSettings(db);
  const template = await getEmailTemplate(db);
  if (!settings || !template) {
    return NextResponse.json({ error: "Email settings or template not configured" }, { status: 500 });
  }

  const vars = buildTemplateVars(data, settings);
  const subject = renderTemplate(template.subject, vars);
  const bodyText = renderTemplate(template.body, vars);
  const html = renderHtmlEmail(bodyText, settings);

  return NextResponse.json({
    family: {
      id: data.family.id,
      name: data.family.name,
      email: data.family.email,
    },
    subject,
    bodyText,
    html,
    balance: data.balanceDue,
    currency: data.currency,
    totalCharged: data.totalCharged,
    totalPaid: data.totalPaid,
  });
}
