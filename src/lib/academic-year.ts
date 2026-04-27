import { HDate } from "@hebcal/core";
import { hebrewYearToLetters, nextHebrewMonth } from "./hebrew-date";
import type { Charge, Child } from "./types";

/**
 * Multi-year support for the app.
 *
 * An "academic year" is identified by its Hebrew year number (e.g. 5786
 * = תשפ״ו). It runs from Elul of (hebrewYear - 1) through Av of hebrewYear
 * — twelve Hebrew months, or thirteen in Hebrew leap years (Adar II is
 * inserted between Adar I and Nisan).
 *
 * Hebrew identity (`hebrew_month`, `hebrew_year`) is the canonical key
 * everywhere in the app: charges store it, statements key rows by it,
 * the spreadsheet grid columns are enumerated from it. The Gregorian
 * (`charges.month`, `charges.year`) pair is the Rosh Chodesh date of
 * each row — used only for FX snapshots and "is this charge in the
 * past" checks. It is NEVER a join key for academic-year filtering.
 *
 * That single rule is what fixed the spreadsheet drift bug: the academic
 * year window had been a civil Sep→Aug Gregorian range, which dropped
 * Rosh-Chodesh-dated rows whose Gregorian month landed in the previous
 * civil month (Elul → late August, Tishrei → late September, …).
 *
 * A "short-stay paid" child is one who was only billed during Elul (6)
 * and/or Tishrei (7) of an academic year AND whose family has no open
 * balance for that year. These are hidden from default views.
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
  // The academic year flips at Rosh Chodesh Elul, not at September 1.
  // RC Elul falls in late August in every Hebrew year (~Aug 25–Sep 1),
  // so we use the actual Hebrew identity of `today` to decide.
  const hd = new HDate(today);
  const hm = hd.getMonth();    // hebcal: 1..13
  const hy = hd.getFullYear();
  // Elul (6) of year H opens academic year (H + 1).
  // Anything else in year H belongs to academic year H.
  const academicHy = hm === 6 ? hy + 1 : hy;
  return academicYearFromHebrew(academicHy);
}

/** True iff a charge with the given Hebrew identity belongs to academic year `hy`. */
export function chargeInAcademicYear(
  hebrewMonth: number | null | undefined,
  hebrewYear: number | null | undefined,
  hy: number,
): boolean {
  if (hebrewMonth == null || hebrewYear == null) return false;
  // Elul of (hy - 1) is the FIRST month of academic year hy.
  if (hebrewMonth === 6 && hebrewYear === hy - 1) return true;
  // Every other Hebrew month of year hy belongs to academic year hy
  // EXCEPT Elul, which already belongs to the next academic year.
  if (hebrewMonth !== 6 && hebrewYear === hy) return true;
  return false;
}

/** True iff a Gregorian-dated payment falls within academic year `hy`. */
export function dateInAcademicYear(iso: string | null | undefined, hy: number): boolean {
  if (!iso || iso.length < 10) return false;
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  const hd = new HDate(new Date(y, m - 1, d));
  return chargeInAcademicYear(hd.getMonth(), hd.getFullYear(), hy);
}

export interface AcademicMonth {
  hebrewMonth: number;        // hebcal numbering: 1..13
  hebrewYear: number;
  /** Gregorian (month, year) of Rosh Chodesh — for FX anchoring + display. */
  gregMonth: number;
  gregYear: number;
}

/**
 * Returns the Hebrew months of academic year `hy` in chronological order:
 * Elul (hy-1), Tishrei (hy), Cheshvan, …, Av (hy). Twelve entries in a
 * non-leap year; thirteen when `hy` is a Hebrew leap year (Adar II is
 * inserted between Adar I and Nisan).
 */
export function academicYearMonths(hy: number): AcademicMonth[] {
  const out: AcademicMonth[] = [];
  let hm = 6;          // Elul
  let hyc = hy - 1;
  // We stop after Av (hebcal month 5) of year hy. Walking forward via
  // nextHebrewMonth handles the year rollover at Elul→Tishrei and the
  // leap-year Adar II automatically.
  for (let i = 0; i < 14; i++) {
    const greg = new HDate(1, hm, hyc).greg();
    out.push({
      hebrewMonth: hm,
      hebrewYear: hyc,
      gregMonth: greg.getMonth() + 1,
      gregYear: greg.getFullYear(),
    });
    if (hm === 5 && hyc === hy) break;
    const nxt = nextHebrewMonth(hm, hyc);
    hm = nxt.hebrewMonth;
    hyc = nxt.hebrewYear;
  }
  return out;
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
 * of the academic year that starts in that September.
 */
export function earliestHebrewYearFromGregorian(earliestGregEnrollmentYear: number): number {
  return earliestGregEnrollmentYear + 3761;
}

/**
 * Does the child's enrollment window overlap academic year `hy` at all?
 * Compares the start/end keys (year*12 + month) against the academic year
 * window expressed in the same units. The window edges use Rosh Chodesh
 * dates: RC Elul of (hy-1) = ~late Aug, RC Elul of hy = ~late Aug + ~12mo.
 */
export function isChildEnrolledInYear(
  child: Pick<Child, "enrollment_start_month" | "enrollment_start_year" | "enrollment_end_month" | "enrollment_end_year">,
  hy: number,
): boolean {
  const sm = child.enrollment_start_month;
  const sy = child.enrollment_start_year;
  const em = child.enrollment_end_month;
  const ey = child.enrollment_end_year;
  if (sm == null || sy == null) return false;
  // Window: from RC Elul (hy-1) to the day before RC Elul (hy).
  const elulPrev = new HDate(1, 6, hy - 1).greg();
  const elulCur = new HDate(1, 6, hy).greg();
  const yearStart = elulPrev.getFullYear() * 12 + (elulPrev.getMonth() + 1);
  // Last billable month is the Gregorian month containing RC of Av (hy),
  // i.e. the month BEFORE elulCur.
  const yearEnd = elulCur.getFullYear() * 12 + elulCur.getMonth();
  const enrollStart = sy * 12 + sm;
  const enrollEnd = em != null && ey != null ? ey * 12 + em : Number.POSITIVE_INFINITY;
  return enrollEnd >= yearStart && enrollStart <= yearEnd;
}

/**
 * The set of hebcal-month numbers the student was actually billed for
 * during academic year `hy`. Reads the canonical `hebrew_month` /
 * `hebrew_year` columns. Returns an empty set when the student has no
 * charges yet — visibility logic treats that as "don't hide" (safe default).
 */
export function hebrewMonthsBilledInYear(
  childCharges: Array<Pick<Charge, "hebrew_month" | "hebrew_year">>,
  hy: number,
): Set<number> {
  const set = new Set<number>();
  for (const c of childCharges) {
    if (!chargeInAcademicYear(c.hebrew_month, c.hebrew_year, hy)) continue;
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

/** Loose shape for the EUR-aware rows used by these aggregations. */
export type YearChargeRow = {
  hebrew_month?: number | null;
  hebrew_year?: number | null;
  eur_amount?: number | null;
};
export type YearPaymentRow = { payment_date: string; eur_amount?: number | null };

export function familyChargedInYear(
  familyCharges: Array<YearChargeRow>,
  hy: number,
): number {
  let s = 0;
  for (const c of familyCharges) {
    if (!chargeInAcademicYear(c.hebrew_month, c.hebrew_year, hy)) continue;
    s += Number(c.eur_amount ?? 0);
  }
  return s;
}

export function familyPaidInYear(
  familyPayments: Array<YearPaymentRow>,
  hy: number,
): number {
  let s = 0;
  for (const p of familyPayments) {
    if (!p.payment_date) continue;
    if (!dateInAcademicYear(p.payment_date, hy)) continue;
    s += Number(p.eur_amount ?? 0);
  }
  return s;
}

export function familyYearBalance(
  familyCharges: Array<YearChargeRow>,
  familyPayments: Array<YearPaymentRow>,
  hy: number,
): number {
  return familyChargedInYear(familyCharges, hy) - familyPaidInYear(familyPayments, hy);
}

/**
 * Hide rule: child was only billed Elul+Tishrei of year Y and the family
 * has no open balance for year Y.
 */
export function isShortStayPaidHidden(
  hebcalMonthsBilled: Set<number>,
  familyYearBalanceEur: number,
): boolean {
  if (!isOnlyElulTishrei(hebcalMonthsBilled)) return false;
  return familyYearBalanceEur <= 0;
}

/**
 * Full visibility decision for a child in year `hy`.
 */
export function isChildVisibleForYear(
  child: Pick<Child, "enrollment_start_month" | "enrollment_start_year" | "enrollment_end_month" | "enrollment_end_year">,
  childCharges: Array<Pick<Charge, "hebrew_month" | "hebrew_year">>,
  familyCharges: Array<YearChargeRow>,
  familyPayments: Array<YearPaymentRow>,
  hy: number,
  includeHidden = false,
): boolean {
  if (!isChildEnrolledInYear(child, hy)) return false;
  if (includeHidden) return true;
  const months = hebrewMonthsBilledInYear(childCharges, hy);
  const balance = familyYearBalance(familyCharges, familyPayments, hy);
  return !isShortStayPaidHidden(months, balance);
}
