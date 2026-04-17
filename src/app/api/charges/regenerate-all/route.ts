import { NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { generateChargesForChild, getCurrentBaseYear } from "@/lib/charge-utils";
import type { Currency } from "@/lib/types";

/**
 * POST /api/charges/regenerate-all
 *
 * Regenerates monthly charges for EVERY active student, covering the
 * last two academic years + the current academic year + the next one
 * (so multi-year enrollments don't leave old months uncovered).
 *
 * Uses upsert + ignoreDuplicates, so calling this repeatedly is safe —
 * existing charge rows aren't clobbered, only missing months are added.
 *
 * This exists because `POST /api/children` wraps `generateChargesForChild`
 * in a silent try/catch; any student whose initial snapshot lookup
 * failed (e.g. because exchange_rates had no USD row yet) got saved
 * without a single charge row. That's why some families show €0 Total
 * Charged even though they have active students.
 *
 * Body (optional): { years?: number }  how many academic years back to
 *                  walk (default 3; max 10).
 */
export async function POST(req: Request) {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await validateSession(token);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = result.user;
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["charges"]?.includes("add"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const yearsBack = Math.max(1, Math.min(10, Number(body.years ?? 3)));
  const currentBase = getCurrentBaseYear();
  // Cover `yearsBack-1` earlier years, the current year, and one ahead
  // (some admins pre-enrol for next September before it arrives).
  const baseYears: number[] = [];
  for (let i = yearsBack - 1; i >= 0; i--) baseYears.push(currentBase - i);
  baseYears.push(currentBase + 1);

  const db = createServerClient();
  const { data: children, error } = await db
    .from("children")
    .select("id, family_id, monthly_tuition, currency, enrollment_start_month, enrollment_start_year, enrollment_end_month, enrollment_end_year")
    .eq("is_active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let totalCreated = 0;
  let skipped = 0;
  const failures: Array<{ child_id: string; message: string }> = [];

  for (const child of children ?? []) {
    const tuition = Number(child.monthly_tuition);
    if (!isFinite(tuition) || tuition <= 0) {
      skipped++;
      continue;
    }
    const currency = (child.currency ?? "EUR") as Currency;
    for (const baseYear of baseYears) {
      try {
        const created = await generateChargesForChild(
          db,
          child.id as string,
          child.family_id as string,
          tuition,
          currency,
          child.enrollment_start_month as number | null,
          child.enrollment_start_year as number | null,
          child.enrollment_end_month as number | null,
          child.enrollment_end_year as number | null,
          baseYear,
        );
        totalCreated += created;
      } catch (e) {
        // Don't swallow — collect and surface so the operator can see
        // which students failed. We still keep going so one bad row
        // doesn't block every other student.
        failures.push({ child_id: child.id as string, message: (e as Error).message });
      }
    }
  }

  return NextResponse.json({
    created: totalCreated,
    studentsProcessed: (children ?? []).length - skipped,
    studentsSkipped: skipped,
    academicYearsCovered: baseYears,
    failures,
  });
}
