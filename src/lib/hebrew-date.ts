import { HDate } from "@hebcal/core";

/**
 * Hebrew calendar utilities for Admin Wilrijk
 *
 * The academic year runs from אלול (Elul, ~Sep) through אב (Av, ~Aug).
 * Hebrew months are used for display; Gregorian months are used for storage.
 *
 * Gregorian month → Hebrew month mapping (approximate, for school year display):
 *   Sep → אלול    (of base year, e.g. תשפ"ה)
 *   Oct → תשרי   (of school year, e.g. תשפ"ו)
 *   Nov → חשון
 *   Dec → כסלו
 *   Jan → טבת
 *   Feb → שבט
 *   Mar → אדר
 *   Apr → ניסן
 *   May → אייר
 *   Jun → סיון
 *   Jul → תמוז
 *   Aug → אב
 */

// Hebrew month names in academic-year order (Sep=0 … Aug=11)
export const HEBREW_MONTH_NAMES = [
  "אלול",   // Sep  (0)
  "תשרי",  // Oct  (1)
  "חשון",  // Nov  (2)
  "כסלו",  // Dec  (3)
  "טבת",   // Jan  (4)
  "שבט",   // Feb  (5)
  "אדר",   // Mar  (6)
  "ניסן",  // Apr  (7)
  "אייר",  // May  (8)
  "סיון",  // Jun  (9)
  "תמוז",  // Jul  (10)
  "אב",    // Aug  (11)
] as const;

/**
 * Convert Gregorian month (1–12) to its index in HEBREW_MONTH_NAMES.
 * Academic year starts in September (month 9 → index 0).
 */
export function gregorianMonthToIndex(month: number): number {
  if (month >= 9) return month - 9;   // Sep=0, Oct=1, Nov=2, Dec=3
  return month + 3;                    // Jan=4, Feb=5, …, Aug=11
}

/**
 * Convert Gregorian year + month to the Hebrew year number (numeric).
 *
 * Sep–Dec of Gregorian year Y → Hebrew year Y + 3761
 * Jan–Aug of Gregorian year Y → Hebrew year Y + 3760
 *
 * Example: Sep 2025 → 5785 (Elul is still in the old Hebrew year)
 *          Oct 2025 → 5786 (after Rosh Hashana)
 */
export function getHebrewYear(gregorianYear: number, month: number): number {
  // Sep is Elul, still in the PREVIOUS Hebrew year
  if (month === 9) return gregorianYear + 3760;
  if (month >= 10) return gregorianYear + 3761; // Oct–Dec
  return gregorianYear + 3760;                  // Jan–Aug
}

/**
 * Convert a Hebrew year number to traditional letter notation.
 * e.g. 5786 → תשפ"ו   5785 → תשפ"ה
 * The thousands digit (5) is omitted in modern usage.
 */
export function hebrewYearToLetters(year: number): string {
  let n = year % 1000; // Drop the thousands (5000)

  const gematria: [number, string][] = [
    [400, "ת"], [300, "ש"], [200, "ר"], [100, "ק"],
    [90, "צ"],  [80, "פ"],  [70, "ע"],  [60, "ס"],
    [50, "נ"],  [40, "מ"],  [30, "ל"],  [20, "כ"],  [10, "י"],
    [9, "ט"],   [8, "ח"],   [7, "ז"],   [6, "ו"],   [5, "ה"],
    [4, "ד"],   [3, "ג"],   [2, "ב"],   [1, "א"],
  ];

  const letters: string[] = [];
  for (const [val, letter] of gematria) {
    while (n >= val) {
      letters.push(letter);
      n -= val;
    }
  }

  // Insert geresh (") before the last letter for multi-letter years
  if (letters.length > 1) {
    letters.splice(letters.length - 1, 0, '"');
  } else if (letters.length === 1) {
    letters.push("'");
  }

  return letters.join("");
}

/**
 * Get the school-year Hebrew year number.
 * Named after the Hebrew year that most months fall in (Oct–Aug).
 * e.g. Gregorian start year 2025 → school year 5786 (תשפ"ו)
 */
export function schoolYearHebrewNumber(gregorianStartYear: number): number {
  return gregorianStartYear + 3761;
}

/**
 * Full academic year label.
 * e.g. 2025 → "שנת הלימודים תשפ״ו"
 */
export function academicYearLabel(gregorianStartYear: number): string {
  const hebrewYear = schoolYearHebrewNumber(gregorianStartYear);
  return `שנת הלימודים ${hebrewYearToLetters(hebrewYear)}`;
}

/**
 * Get the Hebrew month label for a spreadsheet column.
 * e.g. month=9, year=2025 → "אלול תשפ״ה"
 *      month=10, year=2025 → "תשרי תשפ״ו"
 */
export function hebrewMonthLabel(gregorianMonth: number, gregorianYear: number): string {
  const idx = gregorianMonthToIndex(gregorianMonth);
  const monthName = HEBREW_MONTH_NAMES[idx];
  const hebrewYear = getHebrewYear(gregorianYear, gregorianMonth);
  return `${monthName} ${hebrewYearToLetters(hebrewYear)}`;
}

/**
 * Hebcal month numbering → Hebrew month name.
 *   1=Nisan, 2=Iyar, 3=Sivan, 4=Tamuz, 5=Av, 6=Elul,
 *   7=Tishrei, 8=Cheshvan, 9=Kislev, 10=Tevet, 11=Shvat,
 *   12=Adar (non-leap) / Adar I (leap),
 *   13=Adar II (leap only).
 */
const HEBREW_MONTH_NAMES_BY_HEBCAL: Record<number, string> = {
  1: "ניסן", 2: "אייר", 3: "סיון", 4: "תמוז", 5: "אב", 6: "אלול",
  7: "תשרי", 8: "חשון", 9: "כסלו", 10: "טבת", 11: "שבט",
  12: "אדר", 13: "אדר ב׳",
};

/**
 * Build a statement/spreadsheet row label directly from Hebrew identity
 * (hebcal month number + Hebrew year). Use this when rendering rows keyed
 * by the real Hebrew month — unlike `hebrewMonthLabel(gregMonth, gregYear)`
 * it doesn't rely on the Sep→Elul academic-year approximation, so it
 * correctly distinguishes e.g. Nisan 5786 from Iyar 5786 when both Rosh
 * Chodesh-dated charges happen to share the same Gregorian (month, year).
 */
export function hebrewMonthLabelFromHebrew(hebcalMonth: number, hebrewYear: number): string {
  let name = HEBREW_MONTH_NAMES_BY_HEBCAL[hebcalMonth] ?? "";
  if (hebcalMonth === 12 && HDate.isLeapYear(hebrewYear)) name = "אדר א׳";
  return `${name} ${hebrewYearToLetters(hebrewYear)}`;
}

/**
 * One Rosh Chodesh entry, as consumed by the charge generator + cron.
 *  - `gregDate` is the Gregorian date of day 1 of this Hebrew month.
 *  - `hebrewMonth` is the hebcal numbering: 1=Nisan..6=Elul, 7=Tishrei..
 *    12=Adar (or Adar I in leap years), 13=Adar II (leap years only).
 *  - `hebrewYear` is the full Hebrew year number (e.g. 5786).
 */
export interface RoshChodeshEntry {
  gregDate: Date;
  hebrewMonth: number;
  hebrewYear: number;
}

/**
 * Step to the next Hebrew month in chronological (not numerical) order.
 * Hebrew year starts at Tishrei (7), runs 7,8,9,10,11,12,(13 if leap),1,
 * 2,3,4,5,6, then Tishrei of the next year. The "year rollover" happens
 * after Elul (6), not after Adar/Adar II.
 */
export function nextHebrewMonth(hebrewMonth: number, hebrewYear: number): { hebrewMonth: number; hebrewYear: number } {
  if (hebrewMonth === 6) return { hebrewMonth: 7, hebrewYear: hebrewYear + 1 };
  const monthsThisYear = HDate.monthsInYear(hebrewYear);
  if (hebrewMonth === monthsThisYear) return { hebrewMonth: 1, hebrewYear };
  return { hebrewMonth: hebrewMonth + 1, hebrewYear };
}

/**
 * Enumerate every Rosh Chodesh (first of each Hebrew month) whose Gregorian
 * date falls within [startDate, endDate] inclusive. Returns entries in
 * chronological order.
 *
 * Used by the charge generator: each Rosh Chodesh produces exactly one
 * charge row. In leap Hebrew years this naturally yields 13 charges per
 * full year; non-leap years yield 12. Also handles the rare case where
 * two Rosh Chodesh fall in the same Gregorian month (they get distinct
 * (hebrew_month, hebrew_year) keys, so no collision).
 */
export function enumerateRoshChodesh(startDate: Date, endDate: Date): RoshChodeshEntry[] {
  if (endDate < startDate) return [];

  // Find the Rosh Chodesh of the Hebrew month containing startDate — day 1
  // of that HDate's month. If it's strictly before startDate, advance one
  // Hebrew month.
  const startHd = new HDate(startDate);
  let hm = startHd.getMonth();
  let hy = startHd.getFullYear();
  let rcGreg = new HDate(1, hm, hy).greg();
  if (rcGreg < startDate) {
    ({ hebrewMonth: hm, hebrewYear: hy } = nextHebrewMonth(hm, hy));
    rcGreg = new HDate(1, hm, hy).greg();
  }

  const result: RoshChodeshEntry[] = [];
  // Safety cap: one student shouldn't span more than ~30 years of billing.
  for (let i = 0; i < 500 && rcGreg <= endDate; i++) {
    result.push({ gregDate: rcGreg, hebrewMonth: hm, hebrewYear: hy });
    ({ hebrewMonth: hm, hebrewYear: hy } = nextHebrewMonth(hm, hy));
    rcGreg = new HDate(1, hm, hy).greg();
  }
  return result;
}

/**
 * Given a Hebrew month index (0=Elul … 11=Av, academic-year order) and
 * a Hebrew year number (e.g. 5786), return the corresponding Gregorian
 * {month, year}. Inverse of `gregorianMonthToIndex` + `getHebrewYear`.
 *
 * The calendar flips at Rosh Hashana:
 *   - Elul (idx 0) is the last month of the PREVIOUS Hebrew year,
 *     so Gregorian year = hebrewYear - 3760.
 *   - Tishrei..Dec (idx 1..3) are in the Gregorian year = hebrewYear - 3761.
 *   - Jan..Aug     (idx 4..11) are in Gregorian year = hebrewYear - 3760.
 */
export function hebrewToGregorian(hebrewMonthIdx: number, hebrewYear: number): { month: number; year: number } {
  // Map index back to Gregorian month: idx 0→9 (Sep), 1→10 (Oct), …
  const gMonth = hebrewMonthIdx <= 3 ? hebrewMonthIdx + 9 : hebrewMonthIdx - 3;
  let gYear: number;
  if (hebrewMonthIdx === 0) {
    // Elul: Sep of the Gregorian year, still in the previous Hebrew year.
    gYear = hebrewYear - 3760;
  } else if (hebrewMonthIdx <= 3) {
    // Tishrei/Cheshvan/Kislev: Oct-Dec of the *earlier* Gregorian year.
    gYear = hebrewYear - 3761;
  } else {
    // Tevet through Av: Jan-Aug of the *later* Gregorian year.
    gYear = hebrewYear - 3760;
  }
  return { month: gMonth, year: gYear };
}
