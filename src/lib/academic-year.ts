import { hebrewYearToLetters } from "./hebrew-date";
import type { Charge, Child } from "./types";

/**
 * Multi-year support for the app.
 *
 * An "academic year" is identified by its Hebrew year number (e.g. 5786
 * = תשפ״ו). Its Gregorian window runs from Sep 1 of (hebrewYear - 3761)
 * through Aug 31 of (hebrewYear - 3760).
 *
 *   e.g. hebrewYear 5786 = Sep 1 2025 → Aug 31 2026.
 *
 * The first two Hebrew months of an academic year are:
 *   - Elul of (hebrewYear - 1)      — hebcal month 6, before Rosh Hashana
 *   - Tishrei of  hebrewYear        — hebcal month 7, after  Rosh Hashana
 *
 * A "short-stay paid" child is one who was only billed during those two
 * months AND whose family has no open balance for that year. These are
 * hidden from default views per user request — the goal is to keep the
 * current-year spreadsheet clean of students who only overlapped for a
 * couple of months before moving on and have already settled up.
 */

export interface AcademicYear {
  hebrewYear: number;
  gregStartYear: number;
  gregEndYear: number;
  label: string;
  fullLabel: string;
}

export function academicYearFromHebrew(hebrewYear: number): AcademicYear {
  const label = hebrewYearToLetters(hebrewYear);
  return {
    hebrewYear,
    gregStartYear: hebrewYear - 3761,
    gregEndYear: hebrewYear - 3760,
    label,
    fullLabel: `שנת הלימודים ${label}`,
  };
}

export function currentAcademicYear(today: Date = new Date()): AcademicYear {
  const month = today.getMonth() + 1;
  const year = today.getFullYear();
  const hy = month >= 9 ? year + 3761 : year + 3760;
  return academicYearFromHebrew(hy);
}

export function gregInAcademicYear(month: number, year: number, hebrewYear: number): boolean {
  const startYear = hebrewYear - 3761;
  const endYear = hebrewYear - 3760;
  if (year === startYear && month >= 9) return true;
  if (year === endYear && month <= 8) return true;
  return false;
}

export function dateInAcademicYear(iso: string, hebrewYear: number): boolean {
  if (!iso || iso.length < 10) return false;
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return false;
  return gregInAcademicYear(m, y, hebrewYear);
}

/**
 * Returns the 12 Gregorian (month, year) pairs in academic year Y,
 * starting with Sep and ending with Aug.
 */
export function academicYearMonths(hebrewYear: number): Array<{ month: number; year: number }> {
  const startYear = hebrewYear - 3761;
  return [
    { month: 9, year: startYear }, { month: 10, year: startYear }, { month: 11, year: startYear }, { month: 12, year: startYear },
    { month: 1, year: startYear + 1 }, { month: 2, year: startYear + 1 }, { month: 3, year: startYear + 1 }, { month: 4, year: startYear + 1 },
    { month: 5, year: startYear + 1 }, { month: 6, year: startYear + 1 }, { month: 7, year: startYear + 1 }, { month: 8, year: startYear + 1 },
  ];
}

/**
 * List Hebrew academic years from `earliestHebrewYear` (inclusive) up to
 * and including the current year, newest first. Used by the dropdown.
 */
export function listAcademicYears(earliestHebrewYear: number, today: Date = new Date()): AcademicYear[] {
  const cur = currentAcademicYear(today);
  const earliest = Math.min(earliestHebrewYear, cur.hebrewYear);
  const out: AcademicYear[] = [];
  for (let hy = cur.hebrewYear; hy >= earliest; hy--) {
    out.push(academicYearFromHebrew(hy));
  }
  return out;
}

/**
 * Convert an `enrollment_start_year` (Gregorian) to the Hebrew year
 * of the academic year that starts in that September. E.g. enrollment
 * starting Aug 2020 is academic year 5781 (Sep 2020 → Aug 2021), so we
 * pass 2020 and get 5781.
 */
export function earliestHebrewYearFromGregorian(earliestGregEnrollmentYear: number): number {
  return earliestGregEnrollmentYear + 3761;
}

/**
 * Does the child's (enrollment_start..enrollment_end) window overlap
 * academic year Y at all? Answers the "is this student in year Y" question
 * without needing charges rows to exist yet.
 */
export function isChildEnrolledInYear(
  child: Pick<Child, "enrollment_start_month" | "enrollment_start_year" | "enrollment_end_month" | "enrollment_end_year">,
  hebrewYear: number,
): boolean {
  const sm = child.enrollment_start_month;
  const sy = child.enrollment_start_year;
  const em = child.enrollment_end_month;
  const ey = child.enrollment_end_year;
  if (sm == null || sy == null) return false;
  const yearStart = (hebrewYear - 3761) * 12 + 9;
  const yearEnd = (hebrewYear - 3760) * 12 + 8;
  const enrollStart = sy * 12 + sm;
  const enrollEnd = em != null && ey != null ? ey * 12 + em : Number.POSITIVE_INFINITY;
  return enrollEnd >= yearStart && enrollStart <= yearEnd;
}

/**
 * The set of hebcal-month numbers the student was actually billed for
 * during academic year Y. Elul = 6, Tishrei = 7. Uses the `charges` table
 * as the source of truth — if charges haven't been generated yet this
 * returns an empty set, and the visibility rule treats that as "don't
 * hide" (safe default).
 */
export function hebrewMonthsBilledInYear(
  childCharges: Array<Pick<Charge, "month" | "year" | "hebrew_month">>,
  hebrewYear: number,
): Set<number> {
  const set = new Set<number>();
  for (const c of childCharges) {
    if (!gregInAcademicYear(c.month, c.year, hebrewYear)) continue;
    if (c.hebrew_month != null) set.add(c.hebrew_month);
  }
  return set;
}

export function isOnlyElulTishrei(hebcalMonths: Set<number>): boolean {
  if (hebcalMonths.size === 0) return false;
  let ok = true;
  hebcalMonths.forEach((m) => { if (m !== 6 && m !== 7) ok = false; });
  return ok;
}

/** Loose shape for the EUR-aware rows used by these aggregations.
 *  `eur_amount` is marked optional so callers can pass a plain `Charge`
 *  / `Payment` (whose compile-time type lacks the EUR snapshot fields
 *  even though the DB column exists at runtime) without having to cast. */
export type YearChargeRow = { month: number; year: number; eur_amount?: number | null };
export type YearPaymentRow = { payment_date: string; eur_amount?: number | null };
export type YearChargeWithHebrew = YearChargeRow & { hebrew_month: number | null };

export function familyChargedInYear(
  familyCharges: Array<YearChargeRow>,
  hebrewYear: number,
): number {
  let s = 0;
  for (const c of familyCharges) {
    if (!gregInAcademicYear(c.month, c.year, hebrewYear)) continue;
    s += Number(c.eur_amount ?? 0);
  }
  return s;
}

export function familyPaidInYear(
  familyPayments: Array<YearPaymentRow>,
  hebrewYear: number,
): number {
  let s = 0;
  for (const p of familyPayments) {
    if (!p.payment_date) continue;
    if (!dateInAcademicYear(p.payment_date, hebrewYear)) continue;
    s += Number(p.eur_amount ?? 0);
  }
  return s;
}

export function familyYearBalance(
  familyCharges: Array<YearChargeRow>,
  familyPayments: Array<YearPaymentRow>,
  hebrewYear: number,
): number {
  return familyChargedInYear(familyCharges, hebrewYear) - familyPaidInYear(familyPayments, hebrewYear);
}

/**
 * The short-stay hide rule. Returns true if the child should be hidden
 * from default views of year Y:
 *
 *   - Was only billed during Elul (6) and/or Tishrei (7) of year Y, AND
 *   - Family's balance for year Y is ≤ 0 (paid in full or overpaid).
 *
 * Callers should separately confirm the child is enrolled in year Y;
 * this function only handles the hide side of the rule.
 */
export function isShortStayPaidHidden(
  hebcalMonthsBilled: Set<number>,
  familyYearBalanceEur: number,
): boolean {
  if (!isOnlyElulTishrei(hebcalMonthsBilled)) return false;
  return familyYearBalanceEur <= 0;
}

/**
 * Full visibility decision for a child in year Y. Use this from list
 * pages (families, children, spreadsheet) to filter the default view.
 *
 * With `includeHidden = true`, the short-stay hide rule is skipped and
 * every enrolled child is returned.
 */
export function isChildVisibleForYear(
  child: Pick<Child, "enrollment_start_month" | "enrollment_start_year" | "enrollment_end_month" | "enrollment_end_year">,
  childCharges: Array<Pick<Charge, "month" | "year" | "hebrew_month">>,
  familyCharges: Array<YearChargeRow>,
  familyPayments: Array<YearPaymentRow>,
  hebrewYear: number,
  includeHidden = false,
): boolean {
  if (!isChildEnrolledInYear(child, hebrewYear)) return false;
  if (includeHidden) return true;
  const months = hebrewMonthsBilledInYear(childCharges, hebrewYear);
  const balance = familyYearBalance(familyCharges, familyPayments, hebrewYear);
  return !isShortStayPaidHidden(months, balance);
}
