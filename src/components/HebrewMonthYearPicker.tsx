"use client";

import {
  HEBREW_MONTH_NAMES,
  hebrewYearToLetters,
  hebrewToGregorian,
  gregorianMonthToIndex,
  getHebrewYear,
} from "@/lib/hebrew-date";

/**
 * Two dropdowns — Hebrew month + Hebrew year — that together set a
 * Gregorian {month, year} pair. The component is a pure controlled
 * input: the parent owns the Gregorian state, we just render Hebrew
 * labels on top of it.
 *
 * This exists to stop the drift where an operator sees a nice Hebrew
 * label in the UI but the DB underneath holds a Gregorian year from
 * a completely different enrollment period. With explicit Hebrew
 * choosers there's no implicit mapping to get wrong.
 */
interface Props {
  /** Gregorian month (1–12) or null when unset. */
  gregMonth: number | null;
  /** Gregorian year (e.g. 2025) or null when unset. */
  gregYear: number | null;
  /** Called with new Gregorian values when the user picks. */
  onChange: (gregMonth: number, gregYear: number) => void;
  /** Inclusive Hebrew-year range shown in the year dropdown.
   *  Defaults to current Hebrew year ± 3. */
  yearRange?: [number, number];
  /** If true, show an "empty" option (e.g. "no end date"). */
  allowEmpty?: boolean;
  /** Label shown in the empty option; defaults to "—". */
  emptyLabel?: string;
  /** Tailwind classes for each <select>. */
  className?: string;
  /** Disabled state. */
  disabled?: boolean;
}

const CURRENT_HEBREW_YEAR = (() => {
  const now = new Date();
  return getHebrewYear(now.getFullYear(), now.getMonth() + 1);
})();

export default function HebrewMonthYearPicker({
  gregMonth,
  gregYear,
  onChange,
  yearRange,
  allowEmpty = false,
  emptyLabel = "—",
  className = "w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500",
  disabled = false,
}: Props) {
  const [minYear, maxYear] = yearRange ?? [CURRENT_HEBREW_YEAR - 3, CURRENT_HEBREW_YEAR + 3];

  // Compute the currently-selected Hebrew month index + year from the
  // Gregorian values the parent gave us.
  const currentHebIdx = gregMonth != null ? gregorianMonthToIndex(gregMonth) : null;
  const currentHebYear = gregMonth != null && gregYear != null
    ? getHebrewYear(gregYear, gregMonth)
    : null;

  const monthValue = currentHebIdx == null ? "" : String(currentHebIdx);
  const yearValue = currentHebYear == null ? "" : String(currentHebYear);

  function handleChange(nextHebIdx: number | null, nextHebYear: number | null) {
    if (nextHebIdx == null || nextHebYear == null) return;
    const g = hebrewToGregorian(nextHebIdx, nextHebYear);
    onChange(g.month, g.year);
  }

  const years: number[] = [];
  for (let y = minYear; y <= maxYear; y++) years.push(y);

  return (
    <div className="flex gap-1" dir="rtl">
      <select
        value={monthValue}
        onChange={(e) => {
          const idx = e.target.value === "" ? null : Number(e.target.value);
          handleChange(idx, currentHebYear);
        }}
        disabled={disabled}
        className={className}
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {HEBREW_MONTH_NAMES.map((name, i) => (
          <option key={i} value={i}>{name}</option>
        ))}
      </select>
      <select
        value={yearValue}
        onChange={(e) => {
          const y = e.target.value === "" ? null : Number(e.target.value);
          handleChange(currentHebIdx, y);
        }}
        disabled={disabled}
        className={className}
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {years.map((y) => (
          <option key={y} value={y}>{hebrewYearToLetters(y)}</option>
        ))}
      </select>
    </div>
  );
}
