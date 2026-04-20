/**
 * Returns a display name for a family that includes the father's name for disambiguation.
 * e.g. "Cohen (Moshe)" or just "Cohen" if no father name.
 */
export function familyDisplayName(name: string, fatherName?: string | null): string {
  const f = fatherName?.trim();
  if (f) return `${name} (${f})`;
  return name;
}

/**
 * Returns a lowercase key for deduplication that combines name + father's name.
 * e.g. "cohen|moshe" or "cohen"
 */
export function familyMatchKey(name: string, fatherName?: string | null): string {
  const n = name.toLowerCase().trim();
  const f = fatherName?.toLowerCase().trim();
  if (f) return `${n}|${f}`;
  return n;
}

/**
 * Months for which a student should be billed right now:
 *   - starts at (enrollment_start_month, enrollment_start_year) — required.
 *     If either is null, returns [] (no charges — admin needs to fill in
 *     a start before this student can be billed).
 *   - ends at min(enrollment_end, today). If enrollment_end is null we
 *     bill through the current calendar month. Never pre-bills future
 *     months, even if enrollment_end is in the future.
 *
 * The list walks month-by-month, ignoring academic-year boundaries, so a
 * student enrolled across multiple years gets charges for every month
 * in their window.
 */
export function getEnrollmentMonths(
  startMonth: number | null | undefined,
  startYear: number | null | undefined,
  endMonth: number | null | undefined,
  endYear: number | null | undefined,
  today: Date = new Date(),
): { month: number; year: number }[] {
  if (startMonth == null || startYear == null) return [];

  const todayMonth = today.getMonth() + 1;
  const todayYear = today.getFullYear();
  const todayKey = todayYear * 12 + todayMonth;

  // Effective end: the EARLIER of enrollment_end and today.
  let em: number;
  let ey: number;
  if (endMonth != null && endYear != null) {
    const enrollEndKey = endYear * 12 + endMonth;
    if (enrollEndKey <= todayKey) {
      em = endMonth;
      ey = endYear;
    } else {
      em = todayMonth;
      ey = todayYear;
    }
  } else {
    em = todayMonth;
    ey = todayYear;
  }

  const startKey = startYear * 12 + startMonth;
  const endKey = ey * 12 + em;
  if (endKey < startKey) return [];

  const result: { month: number; year: number }[] = [];
  let m = startMonth;
  let y = startYear;
  while (y * 12 + m <= endKey) {
    result.push({ month: m, year: y });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return result;
}
