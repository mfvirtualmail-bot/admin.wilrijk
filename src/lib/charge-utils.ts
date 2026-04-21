import type { SupabaseClient } from "@supabase/supabase-js";
import { HDate } from "@hebcal/core";
import {
  enumerateRoshChodesh,
  gregorianMonthToIndex,
  getHebrewYear,
  nextHebrewMonth,
} from "./hebrew-date";
import { snapshotEurFields } from "./fx";
import type { Currency } from "./types";

/**
 * Academic-year Hebrew-month index (0=Elul..11=Av) → hebcal month number.
 *   Elul=6, Tishrei=7, Cheshvan=8, Kislev=9, Tevet=10, Shvat=11,
 *   Adar=12, Nisan=1, Iyar=2, Sivan=3, Tamuz=4, Av=5.
 * "Adar" is always 12 at this step; callers decide Adar I vs Adar II.
 */
const HEB_IDX_TO_HEBCAL = [6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5] as const;

/**
 * Resolve the stored Gregorian (month, year) back to the Hebrew month the
 * operator actually picked in the UI. The picker round-trips via
 * hebrewToGregorian, so gregorianMonthToIndex + getHebrewYear recovers
 * the original (idx, hebrewYear) pair.
 */
function enrollmentToHebrew(gregMonth: number, gregYear: number): { hebcalMonth: number; hebrewYear: number; idx: number } {
  const idx = gregorianMonthToIndex(gregMonth);
  const hebrewYear = getHebrewYear(gregYear, gregMonth);
  return { hebcalMonth: HEB_IDX_TO_HEBCAL[idx], hebrewYear, idx };
}

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

  // The UI picks a Hebrew month; the DB stores the round-tripped Gregorian
  // (month, year). Build the charge window from Rosh Chodesh boundaries so
  // e.g. enrollment_start=Elul starts at RC Elul (~Aug 25) instead of
  // Sep 1, and enrollment_end=Nisan stops before RC Iyar instead of Apr 30.
  // For Adar in a leap year: start=Adar anchors at Adar I (hebcal 12) so
  // both Adar I and Adar II get billed; end=Adar advances to Adar II
  // (hebcal 13) so both are included.
  const startHeb = enrollmentToHebrew(startMonth, startYear);
  const startDate = new HDate(1, startHeb.hebcalMonth, startHeb.hebrewYear).greg();

  const todayOrThrough = throughDate ?? new Date();
  let effectiveEnd = todayOrThrough;
  if (endMonth != null && endYear != null) {
    const endHeb = enrollmentToHebrew(endMonth, endYear);
    let endHebcal = endHeb.hebcalMonth;
    if (endHebcal === 12 && HDate.isLeapYear(endHeb.hebrewYear)) {
      endHebcal = 13; // Adar II — keep both Adar months inside the window.
    }
    const after = nextHebrewMonth(endHebcal, endHeb.hebrewYear);
    const nextRC = new HDate(1, after.hebrewMonth, after.hebrewYear).greg();
    // Last moment before the next Rosh Chodesh = inclusive end of endMonth.
    const enrollmentBoundary = new Date(nextRC.getTime() - 1);
    if (enrollmentBoundary < effectiveEnd) effectiveEnd = enrollmentBoundary;
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
