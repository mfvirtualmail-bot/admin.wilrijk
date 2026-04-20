import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { generateChargesForChild } from "@/lib/charge-utils";

async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const r = await validateSession(token);
  return r?.user ?? null;
}

// GET /api/charges?family_id=...&child_id=...&year=...
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["charges"]?.includes("view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const db = createServerClient();
  let query = db.from("charges").select("*, children(first_name, last_name)");

  const familyId = searchParams.get("family_id");
  const childId = searchParams.get("child_id");
  const year = searchParams.get("year");

  if (familyId) query = query.eq("family_id", familyId);
  if (childId) query = query.eq("child_id", childId);
  if (year) query = query.eq("year", Number(year));

  const { data, error } = await query.order("year").order("month");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ charges: data });
}

// POST /api/charges — Generate missing charges for active students.
//
// Body (all optional):
//   { family_id?, child_id?, through_date? }
//
// Uses the current enrollment window on each student: charges are
// generated from enrollment_start up to min(enrollment_end, through_date).
// `through_date` defaults to today; pass a future YYYY-MM-DD to pre-bill
// upcoming Hebrew months. Idempotent — existing (child_id, hebrew_month,
// hebrew_year) rows are preserved, safe to combine with the Rosh-Chodesh
// cron.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["charges"]?.includes("add"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const db = createServerClient();

  let throughDate: Date | undefined;
  if (typeof body.through_date === "string" && body.through_date.length > 0) {
    const parsed = new Date(body.through_date);
    if (isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Invalid through_date" }, { status: 400 });
    }
    throughDate = parsed;
  }

  // Load children to generate charges for
  let childQuery = db.from("children").select("*").eq("is_active", true);
  if (body.child_id) {
    childQuery = childQuery.eq("id", body.child_id);
  } else if (body.family_id) {
    childQuery = childQuery.eq("family_id", body.family_id);
  }

  const { data: children, error: childError } = await childQuery;
  if (childError) return NextResponse.json({ error: childError.message }, { status: 500 });

  let totalCreated = 0;
  for (const child of children ?? []) {
    if (Number(child.monthly_tuition) <= 0) continue;
    const currency = child.currency ?? "EUR";
    const created = await generateChargesForChild(
      db,
      child.id,
      child.family_id,
      Number(child.monthly_tuition),
      currency,
      child.enrollment_start_month,
      child.enrollment_start_year,
      child.enrollment_end_month,
      child.enrollment_end_year,
      throughDate,
    );
    totalCreated += created;
  }

  return NextResponse.json({ ok: true, created: totalCreated });
}
