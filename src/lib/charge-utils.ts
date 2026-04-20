import type { SupabaseClient } from "@supabase/supabase-js";
import { getEnrollmentMonths } from "./family-utils";
import { snapshotEurFields } from "./fx";
import type { Currency } from "./types";

/**
 * Generate monthly charges for one student.
 *
 * Rule (as of this revision): charges run from the student's enrollment
 * START month/year up to min(enrollment_end, throughDate). `throughDate`
 * defaults to today — callers who want to pre-bill upcoming months
 * (e.g. "charge all parents for next Hebrew month before it begins")
 * pass a future date here. Months outside an explicit enrollment window
 * are never billed.
 *
 * Uses upsert with ignoreDuplicates so it's safe to call repeatedly —
 * existing (child_id, month, year) rows aren't overwritten. That's what
 * keeps pre-charging and the monthly cron from double-billing.
 */
export async function generateChargesForChild(
  db: SupabaseClient,
  childId: string,
  familyId: string,
  monthlyTuition: number,
  currency: Currency,
  startMonth: number | null,
  startYear: number | null,
  endMonth: number | null,
  endYear: number | null,
  throughDate?: Date,
): Promise<number> {
  if (monthlyTuition <= 0) return 0;

  const months = getEnrollmentMonths(startMonth, startYear, endMonth, endYear, throughDate);
  if (months.length === 0) return 0;

  // Snapshot the EUR equivalent at the rate for each month's first day,
  // so reads never need to re-resolve FX later.
  const rows = await Promise.all(
    months.map(async ({ month, year }) => {
      const date = `${year}-${String(month).padStart(2, "0")}-01`;
      const eur = await snapshotEurFields(monthlyTuition, currency, date);
      return {
        child_id: childId,
        family_id: familyId,
        month,
        year,
        amount: monthlyTuition,
        currency,
        eur_amount: eur.eur_amount,
        eur_rate: eur.eur_rate,
        eur_rate_date: eur.eur_rate_date,
        eur_rate_kind: eur.eur_rate_kind,
      };
    }),
  );

  const { data, error } = await db
    .from("charges")
    .upsert(rows, { onConflict: "child_id,month,year", ignoreDuplicates: true })
    .select("id");

  if (error) throw new Error(`Failed to generate charges: ${error.message}`);
  return data?.length ?? 0;
}

/**
 * Delete every charge for this child, then generate from scratch using
 * the current enrollment window. Called on PUT /api/children/[id] when
 * tuition or enrollment dates change, and on the "Regenerate charges"
 * button to clean up over-billed students.
 *
 * Safety: this is destructive — any charge rows outside the new
 * enrollment window are removed. Payments are NOT touched; they link to
 * families by (family_id, month, year) and have no hard FK to charges.
 */
export async function regenerateChargesForChild(
  db: SupabaseClient,
  childId: string,
  familyId: string,
  monthlyTuition: number,
  currency: Currency,
  startMonth: number | null,
  startYear: number | null,
  endMonth: number | null,
  endYear: number | null,
): Promise<number> {
  const { error: delErr } = await db.from("charges").delete().eq("child_id", childId);
  if (delErr) throw new Error(`Failed to clear charges: ${delErr.message}`);
  return generateChargesForChild(
    db, childId, familyId, monthlyTuition, currency,
    startMonth, startYear, endMonth, endYear,
  );
}

/**
 * Current academic base year (Sep..Aug convention). Retained for UIs
 * that still display by academic year; charge generation no longer
 * uses this.
 */
export function getCurrentBaseYear(): number {
  const now = new Date();
  const month = now.getMonth() + 1;
  return month >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}
