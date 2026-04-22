import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getSessionUser } from "@/lib/api-auth";
import type { EmailTemplate } from "@/lib/types";

/** GET: list all templates, sorted. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.is_super_admin) return NextResponse.json({ error: "Forbidden: super admin only" }, { status: 403 });

  const db = createServerClient();
  const { data, error } = await db
    .from("email_templates")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: (data ?? []) as EmailTemplate[] });
}

/** POST: create a new template. Body: { name, subject, body, locale?, is_default?, sort_order? } */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.is_super_admin) return NextResponse.json({ error: "Forbidden: super admin only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const name = (body.name ?? "").trim();
  const subject = (body.subject ?? "").trim();
  const bodyText: string = body.body ?? "";
  const locale = body.locale === "en" ? "en" : "yi";
  const isDefault = !!body.is_default;
  const sortOrder = Number.isFinite(body.sort_order) ? Number(body.sort_order) : 100;

  if (!name || !subject || !bodyText.trim()) {
    return NextResponse.json({ error: "Name, subject and body are required" }, { status: 400 });
  }

  const db = createServerClient();

  if (isDefault) {
    await db.from("email_templates").update({ is_default: false }).eq("is_default", true);
  }

  const { data, error } = await db
    .from("email_templates")
    .insert({
      name,
      subject,
      body: bodyText,
      locale,
      is_default: isDefault,
      sort_order: sortOrder,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data as EmailTemplate });
}
