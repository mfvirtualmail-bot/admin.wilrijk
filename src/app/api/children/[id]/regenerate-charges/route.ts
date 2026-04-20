import { NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { regenerateChargesForChild } from "@/lib/charge-utils";
import type { Currency } from "@/lib/types";

/**
 * POST /api/children/[id]/regenerate-charges
 *
 * Destructively rebuild one student's charges from their current
 * enrollment window. Used by the per-student "Regen" button on the
 * family detail page — lets operators fix a single student without
 * running the global regenerate-all.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await validateSession(token);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = result.user;
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["children"]?.includes("edit"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const { data: child, error } = await db
    .from("children")
    .select("id, family_id, monthly_tuition, currency, enrollment_start_month, enrollment_start_year, enrollment_end_month, enrollment_end_year")
    .eq("id", params.id)
    .single();
  if (error || !child) return NextResponse.json({ error: error?.message ?? "Student not found" }, { status: 404 });

  const tuition = Number(child.monthly_tuition);
  if (!isFinite(tuition) || tuition <= 0)
    return NextResponse.json({ error: "Student has no monthly_tuition set" }, { status: 400 });
  if (child.enrollment_start_month == null || child.enrollment_start_year == null)
    return NextResponse.json({ error: "Student has no enrollment_start set" }, { status: 400 });

  try {
    const created = await regenerateChargesForChild(
      db,
      child.id as string,
      child.family_id as string,
      tuition,
      (child.currency ?? "EUR") as Currency,
      child.enrollment_start_month as number,
      child.enrollment_start_year as number,
      child.enrollment_end_month as number | null,
      child.enrollment_end_year as number | null,
    );
    return NextResponse.json({ created });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
