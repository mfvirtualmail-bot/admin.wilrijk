import type { SupabaseClient } from "@supabase/supabase-js";
import { enumerateRoshChodesh } from "./hebrew-date";
import { snapshotEurFields } from "./fx";
import type { Currency } from "./types";

/**
 * Generate monthly charges for one student.
 *
 * Model: one charge per Hebrew month (not per Gregorian month). Charges
 * are identified by UNIQUE(child_id, hebrew_month, hebrew_year) so leap
 * Hebrew years naturally get 13 rows per student (Adar I + Adar II).
 *
 * Enumeration: every Rosh Chodesh Gregorian date between the student's
 * enrollment_start (treated as "1st of that Gregorian month") and
 * min(enrollment_end-end-of-month, throughDate). `throughDate` defaults
 * to today; callers can pass a future date to pre-bill upcoming Hebrew
 * months (e.g. "charge all parents for next Hebrew month before it
 * begins"). Months outside an explicit enrollment window are never
 * billed.
 *
 * Storage: each row also keeps the Gregorian (month, year) of the
 * Rosh Chodesh Gregorian date. Dashboard / FX snapshots / statements
 * continue to read those, which is why we don't need a sweeping rewrite
 * of the rest of the app.
 *
 * Uses upsert with ignoreDuplicates on the Hebrew-based unique index,
 * so it's safe to call repeatedly — existing (child_id, hebrew_month,
 * hebrew_year) rows aren't overwritten. That's what prevents the daily
 * Rosh Chodesh cron + an earlier pre-charge from double-billing the
 * same Hebrew month.
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
  if (startMonth == null || startYear == null) return 0;

  const startDate = new Date(startYear, startMonth - 1, 1);

  // Effective end = min(enrollment_end's last day, throughDate ?? today).
  const todayOrThrough = throughDate ?? new Date();
  let effectiveEnd = todayOrThrough;
  if (endMonth != null && endYear != null) {
    // Last day of the enrollment_end month = day 0 of the next month.
    const enrollEndLastDay = new Date(endYear, endMonth, 0);
    if (enrollEndLastDay < effectiveEnd) effectiveEnd = enrollEndLastDay;
  }

  const roshChodeshList = enumerateRoshChodesh(startDate, effectiveEnd);
  if (roshChodeshList.length === 0) return 0;

  // Snapshot the EUR equivalent at the Rosh Chodesh date itself, so
  // reads never need to re-resolve FX later.
  const rows = await Promise.all(
    roshChodeshList.map(async ({ gregDate, hebrewMonth, hebrewYear }) => {
      const iso = `${gregDate.getFullYear()}-${String(gregDate.getMonth() + 1).padStart(2, "0")}-${String(gregDate.getDate()).padStart(2, "0")}`;
      const eur = await snapshotEurFields(monthlyTuition, currency, iso);
      return {
        child_id: childId,
        family_id: familyId,
        // Gregorian (month, year) of the Rosh Chodesh — kept for the
        // existing dashboard/FX/statement code that filters by these.
        month: gregDate.getMonth() + 1,
        year: gregDate.getFullYear(),
        // Hebrew (month, year) — the real identity of the charge, and
        // what the UNIQUE index is built on.
        hebrew_month: hebrewMonth,
        hebrew_year: hebrewYear,
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
    .upsert(rows, { onConflict: "child_id,hebrew_month,hebrew_year", ignoreDuplicates: true })
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
  throughDate?: Date,
): Promise<number> {
  const { error: delErr } = await db.from("charges").delete().eq("child_id", childId);
  if (delErr) throw new Error(`Failed to clear charges: ${delErr.message}`);
  return generateChargesForChild(
    db, childId, familyId, monthlyTuition, currency,
    startMonth, startYear, endMonth, endYear, throughDate,
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
