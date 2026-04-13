import type { SupabaseClient } from "@supabase/supabase-js";
import { getEnrollmentMonths } from "./family-utils";
import type { Currency } from "./types";

/**
 * Generate charges for a single child based on their monthly_tuition and enrollment period.
 * Uses upsert with ignoreDuplicates to safely skip already-existing charges.
 * Returns the number of charges created.
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
  baseYear: number
): Promise<number> {
  if (monthlyTuition <= 0) return 0;

  const months = getEnrollmentMonths(startMonth, startYear, endMonth, endYear, baseYear);
  if (months.length === 0) return 0;

  const rows = months.map(({ month, year }) => ({
    child_id: childId,
    family_id: familyId,
    month,
    year,
    amount: monthlyTuition,
    currency,
  }));

  const { data, error } = await db
    .from("charges")
    .upsert(rows, { onConflict: "child_id,month,year", ignoreDuplicates: true })
    .select("id");

  if (error) throw new Error(`Failed to generate charges: ${error.message}`);
  return data?.length ?? 0;
}

/**
 * Regenerate charges for a child: delete existing charges for the academic year,
 * then create new ones based on current tuition and enrollment period.
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
  baseYear: number
): Promise<number> {
  // Delete existing charges for this child in the academic year range
  const months = getEnrollmentMonths(null, null, null, null, baseYear); // full year range
  for (const { month, year } of months) {
    await db.from("charges").delete().match({ child_id: childId, month, year });
  }

  // Generate new charges
  return generateChargesForChild(
    db, childId, familyId, monthlyTuition, currency,
    startMonth, startYear, endMonth, endYear, baseYear
  );
}

/**
 * Get the current academic base year. If we're in Sep-Dec, the base year is current year.
 * If we're in Jan-Aug, the base year is previous year.
 */
export function getCurrentBaseYear(): number {
  const now = new Date();
  const month = now.getMonth() + 1;
  return month >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}
