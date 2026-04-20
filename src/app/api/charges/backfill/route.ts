import { NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { generateChargesForChild } from "@/lib/charge-utils";
import type { Currency } from "@/lib/types";

/**
 * POST /api/charges/backfill
 *
 * Non-destructive sweep across every active student with an
 * enrollment_start set and tuition > 0. Calls generateChargesForChild
 * which upserts with ignoreDuplicates — existing charge rows are
 * preserved, only missing months are filled in.
 *
 * Contrast with /api/charges/regenerate-all, which wipes and rebuilds.
 * Use this to fix legacy students whose initial generation silently
 * failed (swallowed FX errors, etc.) without touching correctly-billed
 * students.
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
  let studentsWithNewCharges = 0;
  let skippedNoTuition = 0;
  let skippedNoStart = 0;
  const failures: Array<{ child_id: string; message: string }> = [];

  for (const child of children ?? []) {
    const tuition = Number(child.monthly_tuition);
    if (!isFinite(tuition) || tuition <= 0) { skippedNoTuition++; continue; }
    if (child.enrollment_start_month == null || child.enrollment_start_year == null) {
      skippedNoStart++;
      continue;
    }
    try {
      const created = await generateChargesForChild(
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
      totalCreated += created;
      if (created > 0) studentsWithNewCharges++;
    } catch (e) {
      failures.push({ child_id: child.id as string, message: (e as Error).message });
    }
  }

  return NextResponse.json({
    created: totalCreated,
    studentsWithNewCharges,
    studentsProcessed: (children ?? []).length - skippedNoTuition - skippedNoStart,
    studentsSkipped: skippedNoTuition + skippedNoStart,
    skippedReasons: {
      noTuition: skippedNoTuition,
      noEnrollmentStart: skippedNoStart,
    },
    failures,
  });
}
