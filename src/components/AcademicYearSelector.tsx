"use client";

import { useEffect, useState } from "react";
import type { AcademicYear } from "@/lib/academic-year";

interface Props {
  value: number | null;
  onChange: (hebrewYear: number) => void;
  includeHidden?: boolean;
  onIncludeHiddenChange?: (v: boolean) => void;
  compact?: boolean;
}

/**
 * Shared Hebrew academic-year dropdown. Loads /api/academic-years once
 * and renders every known year newest-first. When no year is selected
 * yet, defaults to the current year.
 *
 * If `onIncludeHiddenChange` is provided, also renders a checkbox for
 * the short-stay-paid override. Pages that don't want the override
 * (e.g. the spreadsheet for current year) can simply omit it.
 */
export default function AcademicYearSelector({
  value,
  onChange,
  includeHidden,
  onIncludeHiddenChange,
  compact,
}: Props) {
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/academic-years")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const list: AcademicYear[] = d.years ?? [];
        setYears(list);
        if (value == null && list.length > 0) {
          onChange(list[0].hebrewYear);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={compact ? "inline-flex items-center gap-2" : "flex items-center gap-3 flex-wrap"}>
      <label className="text-sm font-medium text-gray-700" dir="rtl">שנת לימודים:</label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(Number(e.target.value))}
        className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        dir="rtl"
        disabled={!loaded || years.length === 0}
      >
        {!loaded && <option value="">…</option>}
        {years.map((y) => (
          <option key={y.hebrewYear} value={y.hebrewYear}>{y.label}</option>
        ))}
      </select>
      {onIncludeHiddenChange && (
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={!!includeHidden}
            onChange={(e) => onIncludeHiddenChange(e.target.checked)}
            className="w-4 h-4 text-blue-600 rounded"
          />
          <span dir="rtl">כלול תלמידים ששילמו (Elul/Tishrei בלבד)</span>
        </label>
      )}
    </div>
  );
}
