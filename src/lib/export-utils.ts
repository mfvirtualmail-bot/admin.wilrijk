// Excel export helpers built on the xlsx library.
// Dynamically imports xlsx so the library only ships when a user clicks Export.

export type ExportRow = Record<string, unknown>;

export interface ExportSheet {
  name: string;
  headers: string[];
  rows: unknown[][];
}

/**
 * Export a single sheet to an .xlsx file.
 * headers: first row of the sheet
 * rows:    array of arrays, each inner array matching the header order
 */
export async function exportSheet(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: unknown[][],
): Promise<void> {
  await exportWorkbook(filename, [{ name: sheetName, headers, rows }]);
}

/**
 * Export multiple sheets into one .xlsx workbook.
 */
export async function exportWorkbook(filename: string, sheets: ExportSheet[]): Promise<void> {
  const { utils, writeFile } = await import("xlsx");
  const wb = utils.book_new();
  for (const sheet of sheets) {
    const data: unknown[][] = [sheet.headers, ...sheet.rows];
    const ws = utils.aoa_to_sheet(data);
    // xlsx limits sheet names to 31 chars and forbids certain characters
    const safeName = sheet.name.replace(/[\\/?*[\]:]/g, "_").slice(0, 31) || "Sheet";
    utils.book_append_sheet(wb, ws, safeName);
  }
  writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

/**
 * Build a timestamped filename like "families-2026-04-15.xlsx".
 */
export function dateStampedFilename(base: string): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${base}-${yyyy}-${mm}-${dd}.xlsx`;
}
