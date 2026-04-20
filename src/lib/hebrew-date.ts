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
