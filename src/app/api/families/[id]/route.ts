import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { elapsedAcademicMonths } from "@/lib/hebrew-date";

/** Academic-year index (0=Elul … 11=Av) for a Gregorian month number */
function academicIdx(m: number) { return m >= 9 ? m - 9 : m + 3; }
/** Gregorian start year of the academic year that contains this month+year */
function chargeAcademicYear(month: number, year: number) { return month >= 9 ? year : year - 1; }

async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const r = await validateSession(token);
  return r?.user ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["families"]?.includes("view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const [familyRes, childrenRes, paymentsRes, chargesRes] = await Promise.all([
    db.from("families").select("*").eq("id", params.id).single(),
    db.from("children").select("*").eq("family_id", params.id).order("last_name"),
    db.from("payments").select("*").eq("family_id", params.id).order("payment_date", { ascending: false }),
    db.from("charges").select("*").eq("family_id", params.id),
  ]);

  if (familyRes.error || !familyRes.data)
    return NextResponse.json({ error: "Family not found" }, { status: 404 });

  // Only count charges for Hebrew months that have already started.
  // Past academic years are always fully elapsed; the current year uses
  // the real Hebrew calendar via elapsedAcademicMonths().
  const elapsedCache: Record<number, number> = {};
  const totalCharged = (chargesRes.data ?? []).reduce((s, c) => {
    const ay = chargeAcademicYear(c.month, c.year);
    if (!(ay in elapsedCache)) elapsedCache[ay] = elapsedAcademicMonths(ay);
    const elapsed = elapsedCache[ay];
    return academicIdx(c.month) < elapsed ? s + Number(c.amount) : s;
  }, 0);
  const totalPaid = (paymentsRes.data ?? []).reduce((s, p) => s + Number(p.amount), 0);

  return NextResponse.json({
    family: familyRes.data,
    children: childrenRes.data ?? [],
    payments: paymentsRes.data ?? [],
    balance: { charged: totalCharged, paid: totalPaid, due: totalCharged - totalPaid },
  });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["families"]?.includes("edit"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const db = createServerClient();
  const { data, error } = await db
    .from("families")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ family: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["families"]?.includes("delete"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const { error } = await db.from("families").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
