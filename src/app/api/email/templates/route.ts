import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getSessionUser } from "@/lib/api-auth";
import type { EmailTemplate } from "@/lib/types";

// The app ships a single email template. For historical reasons it is
// stored under locale="yi" in the DB (the column is kept so we don't need a
// migration). Any other rows are ignored.
const TEMPLATE_LOCALE = "yi";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.is_super_admin) return NextResponse.json({ error: "Forbidden: super admin only" }, { status: 403 });

  const db = createServerClient();
  const { data, error } = await db
    .from("email_templates")
    .select("*")
    .eq("locale", TEMPLATE_LOCALE)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: (data as EmailTemplate) ?? null });
}

export async function PUT(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.is_super_admin) return NextResponse.json({ error: "Forbidden: super admin only" }, { status: 403 });

  const body = await req.json();
  const { subject, body: bodyText } = body as { subject: string; body: string };

  if (!subject?.trim() || !bodyText?.trim()) {
    return NextResponse.json({ error: "Subject and body are required" }, { status: 400 });
  }

  const db = createServerClient();
  const { error } = await db
    .from("email_templates")
    .upsert(
      { locale: TEMPLATE_LOCALE, subject: subject.trim(), body: bodyText, updated_at: new Date().toISOString() },
      { onConflict: "locale" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
