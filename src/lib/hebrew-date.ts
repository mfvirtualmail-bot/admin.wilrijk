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
 * Map of English Hebrew month names (as returned by Intl hebrew calendar)
 * to academic-year index (Elul=0 … Av=11). Adar I / Adar II in leap years
 * are both treated as Adar (index 6).
 */
const HEBREW_MONTH_TO_ACADEMIC_INDEX: Record<string, number> = {
  Elul: 0,
  Tishri: 1, Tishrei: 1,
  Heshvan: 2, Cheshvan: 2, Marcheshvan: 2,
  Kislev: 3,
  Tevet: 4, Teves: 4,
  Shevat: 5, "Sh'vat": 5,
  Adar: 6, "Adar I": 6, "Adar II": 6,
  Nisan: 7,
  Iyar: 8, Iyyar: 8,
  Sivan: 9,
  Tamuz: 10, Tammuz: 10,
  Av: 11,
};

/**
 * Returns today's Hebrew month academic-year index (0..11) and Hebrew year,
 * using the system Hebrew calendar (Intl). Returns null if the environment
 * doesn't support it.
 */
export function currentHebrewMonth(now: Date = new Date()): { index: number; hebrewYear: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-u-ca-hebrew", { month: "long", year: "numeric" });
    const parts = fmt.formatToParts(now);
    const monthName = parts.find((p) => p.type === "month")?.value ?? "";
    const yearStr = parts.find((p) => p.type === "year")?.value ?? "";
    const hebrewYear = parseInt(yearStr.replace(/\D/g, ""), 10);
    const index = HEBREW_MONTH_TO_ACADEMIC_INDEX[monthName];
    if (index == null || !hebrewYear) return null;
    return { index, hebrewYear };
  } catch {
    return null;
  }
}

/**
 * Returns how many academic months have ALREADY STARTED for the given
 * academic year, as of `now`. Each Hebrew month is considered charged
 * from its 1st day (Rosh Chodesh).
 *
 * Academic year N (e.g. 2025) covers:
 *   Elul of Hebrew year (N + 3760)  → index 0
 *   Tishri … Av of Hebrew year (N + 3761) → indexes 1..11
 *
 * Returns 0 if the academic year hasn't started, 12 if it has fully ended.
 */
export function elapsedAcademicMonths(academicYear: number, now: Date = new Date()): number {
  const cur = currentHebrewMonth(now);
  if (!cur) {
    // Fallback: use Gregorian approximation
    const m = now.getMonth() + 1;
    const y = now.getFullYear();
    const curAcademic = m >= 9 ? y : y - 1;
    if (curAcademic < academicYear) return 0;
    if (curAcademic > academicYear) return 12;
    return Math.min(12, gregorianMonthToIndex(m) + 1);
  }

  const startHebYear = academicYear + 3760; // year containing Elul (1st month)
  const mainHebYear = academicYear + 3761;  // year containing Tishri..Av

  if (cur.hebrewYear < startHebYear) return 0;
  if (cur.hebrewYear === startHebYear) {
    // Only Elul (index 0) of this year counts as "started"
    return cur.index === 0 ? 1 : 0;
  }
  if (cur.hebrewYear > mainHebYear) return 12;
  // cur.hebrewYear === mainHebYear: Tishri..Av are 1..11, Elul = next year's start
  if (cur.index === 0) return 12; // Elul of next academic year → this year is done
  return Math.min(12, cur.index + 1);
}
