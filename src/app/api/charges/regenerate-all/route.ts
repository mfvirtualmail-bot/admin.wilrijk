import { NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { regenerateChargesForChild } from "@/lib/charge-utils";
import type { Currency } from "@/lib/types";

/**
 * POST /api/charges/regenerate-all
 *
 * Destructively regenerate monthly charges for EVERY active student.
 * For each student: wipe existing charges, then create fresh ones
 * from enrollment_start up to min(enrollment_end, today).
 *
 * Why destructive: a previous (now-fixed) bug generated charges across
 * multiple academic years regardless of the enrollment window. Some
 * students ended up with charges far outside their real enrollment.
 * This endpoint brings the `charges` table back into sync with the
 * current enrollment data on each student.
 *
 * Safety: `payments` have no FK to `charges` (they're linked loosely
 * via family_id + month + year), so clearing charges never deletes
 * payment records. If a student has payments for months their
 * enrollment window no longer covers, those payments remain visible
 * (just "unmatched") — fix by updating the student's enrollment dates
 * and running this again.
 */
export async function POST() {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await validateSession(token);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = result.user;
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["charges"]?.includes("add"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const { data: children, error } = await db
    .from("children")
    .select("id, family_id, monthly_tuition, currency, enrollment_start_month, enrollment_start_year, enrollment_end_month, enrollment_end_year")
    .eq("is_active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let totalCreated = 0;
  let skippedNoTuition = 0;
  let skippedNoStart = 0;
  const failures: Array<{ child_id: string; message: string }> = [];

  for (const child of children ?? []) {
    const tuition = Number(child.monthly_tuition);
    if (!isFinite(tuition) || tuition <= 0) {
      skippedNoTuition++;
      continue;
    }
    // Per the new rule: charges require an explicit start. Without one
    // we'd have no idea where to begin — skip rather than guess.
    if (child.enrollment_start_month == null || child.enrollment_start_year == null) {
      skippedNoStart++;
      continue;
    }
    const currency = (child.currency ?? "EUR") as Currency;
    try {
      const created = await regenerateChargesForChild(
        db,
        child.id as string,
        child.family_id as string,
        tuition,
        currency,
        child.enrollment_start_month as number,
        child.enrollment_start_year as number,
        child.enrollment_end_month as number | null,
        child.enrollment_end_year as number | null,
      );
      totalCreated += created;
    } catch (e) {
      failures.push({ child_id: child.id as string, message: (e as Error).message });
    }
  }

  return NextResponse.json({
    created: totalCreated,
    studentsProcessed: (children ?? []).length - skippedNoTuition - skippedNoStart,
    studentsSkipped: skippedNoTuition + skippedNoStart,
    skippedReasons: {
      noTuition: skippedNoTuition,
      noEnrollmentStart: skippedNoStart,
    },
    failures,
  });
}
