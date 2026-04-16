import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getSessionUser } from "@/lib/api-auth";
import type { EmailTemplate } from "@/lib/types";

const SUPPORTED_LOCALES = ["en", "yi"] as const;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.is_super_admin) return NextResponse.json({ error: "Forbidden: super admin only" }, { status: 403 });

  const db = createServerClient();
  const { data, error } = await db.from("email_templates").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Ensure both locales present in the response (empty defaults if missing).
  const byLocale: Record<string, EmailTemplate> = {};
  for (const t of (data ?? []) as EmailTemplate[]) byLocale[t.locale] = t;
  return NextResponse.json({ templates: byLocale });
}

export async function PUT(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.is_super_admin) return NextResponse.json({ error: "Forbidden: super admin only" }, { status: 403 });

  const body = await req.json();
  const { locale, subject, body: bodyText } = body as { locale: string; subject: string; body: string };

  if (!SUPPORTED_LOCALES.includes(locale as (typeof SUPPORTED_LOCALES)[number])) {
    return NextResponse.json({ error: "Unsupported locale" }, { status: 400 });
  }
  if (!subject?.trim() || !bodyText?.trim()) {
    return NextResponse.json({ error: "Subject and body are required" }, { status: 400 });
  }

  const db = createServerClient();
  const { error } = await db
    .from("email_templates")
    .upsert(
      { locale, subject: subject.trim(), body: bodyText, updated_at: new Date().toISOString() },
      { onConflict: "locale" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
