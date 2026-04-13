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

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["payments"]?.includes("view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const familyId = searchParams.get("family_id");

  const db = createServerClient();
  let query = db
    .from("payments")
    .select("*, families(name, father_name)")
    .order("payment_date", { ascending: false });
  if (familyId) query = query.eq("family_id", familyId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ payments: data });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["payments"]?.includes("add"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { family_id, amount, payment_date, payment_method, month, year, reference, notes, currency } = body;
  if (!family_id || !amount || !payment_date || !payment_method)
    return NextResponse.json({ error: "family_id, amount, payment_date and payment_method are required" }, { status: 400 });

  const db = createServerClient();

  const { data, error } = await db
    .from("payments")
    .insert({ family_id, amount: Number(amount), payment_date, payment_method, month, year, reference, notes, currency: currency ?? "EUR" })
    .select("*, families(name, father_name)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ payment: data }, { status: 201 });
}
