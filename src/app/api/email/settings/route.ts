import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getSessionUser } from "@/lib/api-auth";
import type { EmailSettings } from "@/lib/types";

const PASSWORD_MASK = "__unchanged__";

/** Redact smtp_password before sending settings to the browser. Returns a
 * boolean `has_password` instead so the UI can show "password set". */
function redact(s: EmailSettings): Omit<EmailSettings, "smtp_password"> & { has_password: boolean } {
  // Intentionally drop smtp_password from the response.
  const { smtp_password, ...rest } = s;
  return { ...rest, has_password: !!smtp_password };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.is_super_admin) return NextResponse.json({ error: "Forbidden: super admin only" }, { status: 403 });

  const db = createServerClient();
  const { data } = await db.from("email_settings").select("*").eq("id", 1).single();
  if (!data) return NextResponse.json({ settings: null });
  return NextResponse.json({ settings: redact(data as EmailSettings) });
}

export async function PUT(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.is_super_admin) return NextResponse.json({ error: "Forbidden: super admin only" }, { status: 403 });

  const body = await req.json();
  const db = createServerClient();

  // Whitelist updatable fields. smtp_password is only overwritten when a real
  // new value is provided; PASSWORD_MASK means "don't touch".
  const allowed = [
    "smtp_host",
    "smtp_port",
    "smtp_secure",
    "smtp_user",
    "from_name",
    "from_email",
    "reply_to",
    "bcc_admin",
    "org_name",
    "org_address",
    "org_logo_url",
    "payment_instructions",
  ];
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) {
    if (k in body) update[k] = body[k];
  }
  // Gmail displays app passwords with spaces ("abcd efgh ijkl mnop") but the
  // SMTP server expects them without. Also trim any newlines/tabs a user
  // may have copied in. Same for smtp_user — Gmail is case-insensitive but
  // stray whitespace will break auth.
  if (typeof update.smtp_user === "string") {
    update.smtp_user = (update.smtp_user as string).trim();
  }
  if ("smtp_password" in body && body.smtp_password !== PASSWORD_MASK) {
    const raw = body.smtp_password;
    update.smtp_password = raw ? String(raw).replace(/\s+/g, "") : null;
  }

  const { error } = await db.from("email_settings").upsert({ id: 1, ...update }, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Return the redacted, post-save state so the UI can verify immediately
  // that the password was stored (avoids a stale-read situation where the
  // browser shows "empty" even though the value went through).
  const { data } = await db.from("email_settings").select("*").eq("id", 1).single();
  if (!data) return NextResponse.json({ ok: true, settings: null });
  return NextResponse.json({ ok: true, settings: redact(data as EmailSettings) });
}
