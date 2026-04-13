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
 * Given enrollment period fields (or nulls for defaults), return the list of {month, year}
 * the child is enrolled for within the given academic year.
 * Academic year runs Sep (baseYear) → Aug (baseYear+1).
 */
export function getEnrollmentMonths(
  startMonth: number | null | undefined,
  startYear: number | null | undefined,
  endMonth: number | null | undefined,
  endYear: number | null | undefined,
  baseYear: number
): { month: number; year: number }[] {
  const sm = startMonth ?? 9;
  const sy = startYear ?? baseYear;
  const em = endMonth ?? 8;
  const ey = endYear ?? baseYear + 1;

  // Build full academic year month list, then filter to enrollment window
  const ACADEMIC_MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];
  const result: { month: number; year: number }[] = [];

  for (const m of ACADEMIC_MONTHS) {
    const y = m >= 9 ? baseYear : baseYear + 1;
    // Check if this month is within the enrollment period
    const monthKey = y * 100 + m;
    const startKey = sy * 100 + sm;
    const endKey = ey * 100 + em;
    if (monthKey >= startKey && monthKey <= endKey) {
      result.push({ month: m, year: y });
    }
  }

  return result;
}
