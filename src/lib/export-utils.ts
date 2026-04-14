/**
 * Shared helper to export a list of records to an .xlsx file.
 * Uses dynamic import so xlsx only loads when the user clicks Export.
 */
export async function exportToExcel(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: unknown[][],
) {
  const { utils, writeFile } = await import("xlsx");
  const ws = utils.aoa_to_sheet([headers, ...rows]);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); // Excel sheet name max 31 chars
  const today = new Date().toISOString().slice(0, 10);
  writeFile(wb, `${filename}-${today}.xlsx`);
}
