import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getSessionUser } from "@/lib/api-auth";
import { getEmailSettings, buildTransporter } from "@/lib/email-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/email/verify — tries an SMTP handshake with the saved
 * credentials and returns a readable success/error message. Does not send
 * any email. Super-admin only. */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.is_super_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const settings = await getEmailSettings(db);
  if (!settings?.smtp_user || !settings.smtp_password) {
    return NextResponse.json({ ok: false, error: "SMTP credentials are empty." }, { status: 400 });
  }

  try {
    const tx = buildTransporter(settings);
    await tx.verify();
    return NextResponse.json({
      ok: true,
      host: settings.smtp_host,
      port: settings.smtp_port,
      user: settings.smtp_user,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 200 });
  }
}
