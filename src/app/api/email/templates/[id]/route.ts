import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getSessionUser } from "@/lib/api-auth";
import type { EmailTemplate } from "@/lib/types";

interface Ctx {
  params: { id: string };
}

export async function GET(_req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.is_super_admin) return NextResponse.json({ error: "Forbidden: super admin only" }, { status: 403 });

  const db = createServerClient();
  const { data, error } = await db.from("email_templates").select("*").eq("id", params.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ template: data as EmailTemplate });
}

export async function PUT(req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.is_super_admin) return NextResponse.json({ error: "Forbidden: super admin only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const db = createServerClient();

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string") {
    const n = body.name.trim();
    if (!n) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    update.name = n;
  }
  if (typeof body.subject === "string") {
    const s = body.subject.trim();
    if (!s) return NextResponse.json({ error: "Subject cannot be empty" }, { status: 400 });
    update.subject = s;
  }
  if (typeof body.body === "string") {
    if (!body.body.trim()) return NextResponse.json({ error: "Body cannot be empty" }, { status: 400 });
    update.body = body.body;
  }
  if (body.locale === "en" || body.locale === "yi") update.locale = body.locale;
  if (typeof body.is_default === "boolean") update.is_default = body.is_default;
  if (Number.isFinite(body.sort_order)) update.sort_order = Number(body.sort_order);

  // Clearing defaults first only matters when we're promoting this row.
  if (update.is_default === true) {
    await db.from("email_templates").update({ is_default: false }).neq("id", params.id);
  }

  const { data, error } = await db
    .from("email_templates")
    .update(update)
    .eq("id", params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data as EmailTemplate });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.is_super_admin) return NextResponse.json({ error: "Forbidden: super admin only" }, { status: 403 });

  const db = createServerClient();
  const { data: row } = await db.from("email_templates").select("is_default").eq("id", params.id).maybeSingle();
  if (row?.is_default) {
    return NextResponse.json({ error: "Cannot delete the default template. Mark another as default first." }, { status: 400 });
  }
  const { count } = await db.from("email_templates").select("id", { count: "exact", head: true });
  if ((count ?? 0) <= 1) {
    return NextResponse.json({ error: "Cannot delete the last template." }, { status: 400 });
  }
  const { error } = await db.from("email_templates").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
