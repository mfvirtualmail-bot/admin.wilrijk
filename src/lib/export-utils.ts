/**
 * Client-side Excel export helpers built on the `xlsx` library. The
 * library is lazy-loaded so list pages don't pay the ~600kB parse
 * cost unless the user actually clicks "Export".
 *
 * All exporters take pre-filtered data from the calling page — the
 * spec says exports should mirror whatever the user is currently
 * looking at (search / filter applied).
 */

export interface ExportSheet {
  name: string;
  /** First row should be the headers; subsequent rows are data. */
  rows: unknown[][];
}

/** Trigger a download of one or more sheets as an .xlsx file. */
export async function exportToExcel(filename: string, sheets: ExportSheet[]) {
  const { utils, writeFile } = await import("xlsx");
  const wb = utils.book_new();
  for (const s of sheets) {
    const ws = utils.aoa_to_sheet(s.rows);
    utils.book_append_sheet(wb, ws, s.name.slice(0, 31)); // Excel 31-char limit
    // Auto-size columns by max length per column.
    const widths = s.rows.reduce<number[]>((acc, row) => {
      row.forEach((cell, i) => {
        const len = cell == null ? 0 : String(cell).length;
        acc[i] = Math.max(acc[i] ?? 0, len);
      });
      return acc;
    }, []);
    ws["!cols"] = widths.map((w) => ({ wch: Math.min(50, Math.max(8, w + 2)) }));
  }
  const safe = filename.replace(/[^a-z0-9._-]+/gi, "_");
  writeFile(wb, safe.endsWith(".xlsx") ? safe : `${safe}.xlsx`);
}

/** Format an ISO date (YYYY-MM-DD) for spreadsheet display as DD-MM-YYYY. */
export function formatDateForExport(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = String(iso).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

/** Today as a short timestamp suitable for filenames. */
export function exportTimestamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
