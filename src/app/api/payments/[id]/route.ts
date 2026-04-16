import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";

async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const r = await validateSession(token);
  return r?.user ?? null;
}

/** GET /api/payments/:id
 *  Returns a single payment (with joined family). Used by the edit page. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["payments"]?.includes("view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const { data, error } = await db
    .from("payments")
    .select("*, families(name, father_name)")
    .eq("id", params.id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ payment: data });
}

/** PATCH /api/payments/:id
 *  Updates an existing payment. Accepts any subset of: family_id, amount,
 *  payment_date, payment_method, month, year, reference, notes, currency. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["payments"]?.includes("edit"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const allowed: Record<string, unknown> = {};
  const keys = ["family_id", "amount", "payment_date", "payment_method", "month", "year", "reference", "notes", "currency"] as const;
  for (const k of keys) {
    if (k in body) allowed[k] = body[k];
  }
  if ("amount" in allowed) {
    const n = Number(allowed.amount);
    if (!isFinite(n) || n <= 0) return NextResponse.json({ error: "Amount must be positive" }, { status: 400 });
    allowed.amount = n;
  }
  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const db = createServerClient();
  const { data, error } = await db
    .from("payments")
    .update(allowed)
    .eq("id", params.id)
    .select("*, families(name, father_name)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ payment: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["payments"]?.includes("delete"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const { error } = await db.from("payments").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
