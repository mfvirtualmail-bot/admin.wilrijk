/**
 * Excel parsing and column-mapping utilities for Admin Wilrijk import flows.
 * Uses the xlsx library (already installed) for file parsing.
 */

import type { PaymentMethod } from "./types";
import { HEBREW_MONTH_NAMES } from "./hebrew-date";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface ParsedSheet {
  headers: string[];       // first row values (may be empty strings)
  rows: unknown[][];       // subsequent rows as arrays
}

export interface ParsedWorkbook {
  sheetNames: string[];
  getSheet: (name: string) => ParsedSheet;
}

/** One month group detected in a payment Excel file */
export interface PaymentMonthGroup {
  /** 0-based index of the date column */
  dateCol: number;
  /** 0-based index of the method (COM) column */
  methodCol: number;
  /** 0-based index of the amount column */
  amountCol: number;
  /** Gregorian month number 1–12 */
  month: number;
  /** Gregorian year, e.g. 2025 */
  year: number;
}

// ──────────────────────────────────────────────
// Parsing
// ──────────────────────────────────────────────

/**
 * Parse an Excel / CSV File object in the browser.
 * Returns a workbook handle with sheet names and per-sheet accessors.
 * Uses dynamic import so xlsx only loads when needed.
 */
export async function parseExcelFile(file: File): Promise<ParsedWorkbook> {
  const xlsx = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const wb = xlsx.read(buffer, { type: "array", cellDates: true });

  function getSheet(name: string): ParsedSheet {
    const ws = wb.Sheets[name];
    if (!ws) return { headers: [], rows: [] };
    const data = xlsx.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      raw: false,   // format numbers/dates as strings
    }) as unknown[][];

    if (data.length === 0) return { headers: [], rows: [] };
    const headers = (data[0] as unknown[]).map((h) =>
      h == null ? "" : String(h).trim()
    );
    const rows = data.slice(1);
    return { headers, rows };
  }

  return { sheetNames: wb.SheetNames, getSheet };
}

// ──────────────────────────────────────────────
// Auto-suggest for Family import
// ──────────────────────────────────────────────

const FAMILY_HEADER_HINTS: Record<string, string[]> = {
  family_name:      ["familienaam", "family", "naam", "name", "achternaam", "familie"],
  father_name:      ["vader", "father", "voorn vader", "voornaam vader", "vaders naam"],
  mother_name:      ["moeder", "mother", "voorn moeder", "voornaam moeder"],
  hebrew_family_name: ["שם משפ", "שם משפחה", "hebrew family", "hebrew name"],
  hebrew_father_name: ["שם אב", "שם האב", "hebrew father"],
  child_first_name: ["bochur", "voorn bochur", "kind", "child", "student", "voornaam kind", "leerling", "שם בוחר"],
  child_last_name:  ["achternaam kind", "kind achternaam"],
  child_hebrew_name: ["שם בחור", "hebrew student", "hebrew child"],
  child_dob:        ["geb", "geb. datum", "geboortedatum", "birth", "date of birth", "dob", "datum"],
  address:          ["adres", "address", "straat", "street"],
  postal_code:      ["postc", "postcode", "postal", "zip", "post"],
  city:             ["gemeente", "city", "stad", "woonplaats", "place"],
  phone:            ["tel", "phone", "telefoon", "gsm", "mobiel", "tel."],
  rijksregister:    ["rijksregister", "national", "registry", "rijks", "rrn"],
  email:            ["email", "e-mail", "mail"],
  monthly_tuition:  ["maandelijks", "schoolgeld", "tuition", "bedrag", "monthly"],
  notes:            ["opmerkingen", "notes", "nota", "opmerking"],
};

export const FAMILY_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: "family_name",        label: "Family Name (Familienaam)",        required: true },
  { key: "father_name",        label: "Father's First Name (Voorn Vader)" },
  { key: "mother_name",        label: "Mother's First Name (Voorn Moeder)" },
  { key: "hebrew_family_name", label: "Hebrew Family Name (שם משפחה)" },
  { key: "hebrew_father_name", label: "Hebrew Father's Name (שם אב)" },
  { key: "child_first_name",   label: "Student First Name (Voorn Bochur)" },
  { key: "child_last_name",    label: "Student Last Name" },
  { key: "child_hebrew_name",  label: "Student Hebrew Name (שם בחור)" },
  { key: "child_dob",          label: "Birth Date (Geb. Datum)" },
  { key: "address",            label: "Address (Adres)" },
  { key: "postal_code",        label: "Postal Code (Postcode)" },
  { key: "city",               label: "City (Gemeente)" },
  { key: "phone",              label: "Phone (Tel)" },
  { key: "rijksregister",      label: "National Registry (Rijksregister)" },
  { key: "email",              label: "Email" },
  { key: "monthly_tuition",    label: "Monthly Tuition (€)" },
  { key: "notes",              label: "Notes" },
  { key: "skip",               label: "— Skip this column —" },
];

/**
 * Given an array of Excel column headers, suggest field mappings.
 * Returns a map from column index (0-based) to field key.
 */
export function suggestFamilyMappings(headers: string[]): Record<number, string> {
  const result: Record<number, string> = {};
  const usedFields = new Set<string>();

  headers.forEach((header, idx) => {
    const h = header.toLowerCase().trim();
    if (!h) { result[idx] = "skip"; return; }

    for (const [fieldKey, hints] of Object.entries(FAMILY_HEADER_HINTS)) {
      if (usedFields.has(fieldKey)) continue;
      if (hints.some((hint) => h.includes(hint) || hint.includes(h))) {
        result[idx] = fieldKey;
        usedFields.add(fieldKey);
        return;
      }
    }

    result[idx] = "skip";
  });

  return result;
}

// ──────────────────────────────────────────────
// Auto-suggest for Payment import
// ──────────────────────────────────────────────

/** Hebrew month name → Gregorian month (1-12) */
const HEBREW_TO_GREGORIAN: Record<string, number> = {
  "אלול":  9,
  "תשרי": 10,
  "חשון": 11,
  "כסלו": 12,
  "טבת":   1,
  "שבט":   2,
  "אדר":   3,
  "ניסן":  4,
  "אייר":  5,
  "סיון":  6,
  "תמוז":  7,
  "אב":    8,
};

/** Detect which Gregorian month a cell value refers to, or null if not a month. */
function detectHebrewMonth(value: string): number | null {
  const v = value.trim();
  for (const [heb, greg] of Object.entries(HEBREW_TO_GREGORIAN)) {
    if (v.includes(heb)) return greg;
  }
  // Also handle English month names as fallback
  const englishMonths: Record<string, number> = {
    "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4,
    "may": 5, "jun": 6, "jul": 7, "aug": 8,
  };
  const lower = v.toLowerCase();
  for (const [eng, greg] of Object.entries(englishMonths)) {
    if (lower.includes(eng)) return greg;
  }
  return null;
}

/**
 * Detect the repeating month-group structure in a payment Excel.
 * Expected structure: [FamilyName, Date, Method, Amount, Date, Method, Amount, …]
 * The Amount column header is the Hebrew month name.
 *
 * @param headers  Excel column headers (row 0)
 * @param academicYear  Start year of the academic year (e.g. 2025 for 2025/2026)
 * @returns  familyNameCol index and detected month groups
 */
export function suggestPaymentMappings(
  headers: string[],
  academicYear: number
): { familyNameCol: number; monthGroups: PaymentMonthGroup[] } {
  let familyNameCol = 0;

  // Find the family name column: typically column 0, or the first non-date/non-number header
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim();
    if (!h || h === "תאריך" || h === "com" || detectHebrewMonth(headers[i]) !== null) continue;
    familyNameCol = i;
    break;
  }

  const monthGroups: PaymentMonthGroup[] = [];

  // Scan remaining columns for month patterns: Date | COM | Amount (month name)
  // The amount column carries the Hebrew month name as its header
  for (let i = familyNameCol + 1; i < headers.length - 2; i++) {
    const h2 = headers[i + 2];
    const month = detectHebrewMonth(h2);
    if (month === null) continue;

    // Verify left two columns look like date/method columns
    const h0 = headers[i].toLowerCase().trim();
    const h1 = headers[i + 1].toLowerCase().trim();
    const looksLikeDateCol = h0 === "" || h0.includes("תאריך") || h0.includes("date");
    const looksLikeMethodCol = h1 === "" || h1 === "com" || h1.includes("method") || h1.includes("com");

    if (looksLikeDateCol || looksLikeMethodCol || monthGroups.length === 0) {
      const year = month >= 9 ? academicYear : academicYear + 1;
      // Check for duplicate month
      const alreadyAdded = monthGroups.some((g) => g.month === month && g.year === year);
      if (!alreadyAdded) {
        monthGroups.push({ dateCol: i, methodCol: i + 1, amountCol: i + 2, month, year });
        i += 2; // skip the 3 columns we just consumed
      }
    }
  }

  return { familyNameCol, monthGroups };
}

// ──────────────────────────────────────────────
// Data conversion helpers
// ──────────────────────────────────────────────

/**
 * Parse a European date string (DD-MM-YY or DD-MM-YYYY or DD/MM/YYYY) to ISO date.
 * Returns null if parsing fails.
 */
export function parseEuropeanDate(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Already ISO format YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD-MM-YY or DD-MM-YYYY or DD/MM/YYYY
  const match = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (!match) return null;
  const [, d, m, y] = match;
  const day = parseInt(d, 10);
  const month = parseInt(m, 10);
  let year = parseInt(y, 10);
  if (year < 100) year += 2000;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Detect currency from an amount string based on currency symbols.
 * Returns the detected currency code or "EUR" as default.
 */
export function detectCurrency(raw: unknown): string {
  if (!raw) return "EUR";
  const s = String(raw);
  if (/\$/.test(s)) return "USD";
  if (/£/.test(s)) return "GBP";
  if (/€/.test(s)) return "EUR";
  return "EUR"; // Default to EUR
}

/**
 * Parse an amount value, stripping currency symbols and whitespace.
 * Returns null for empty/zero values.
 */
export function parseAmount(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).replace(/[€£$,\s]/g, "").trim();
  if (!s) return null;
  const n = parseFloat(s);
  if (isNaN(n) || n <= 0) return null;
  return n;
}

/** Map of known payment method variants to canonical values */
const METHOD_MAP: Record<string, PaymentMethod> = {
  crc: "crc", credit: "crc", "credit card": "crc",
  kas: "kas", cash: "kas", contant: "kas",
  bank: "bank", transfer: "bank", overschrijving: "bank",
  other: "other", anders: "other",
  // Unknown codes become "other"
  jj: "other", "#": "other",
};

/**
 * Normalize a raw payment method string to a canonical PaymentMethod.
 * Returns "other" for unrecognized values.
 */
export function normalizePaymentMethod(raw: unknown): PaymentMethod {
  if (!raw) return "kas";
  const s = String(raw).toLowerCase().trim();
  return METHOD_MAP[s] ?? "other";
}

/**
 * Get a display label for the Hebrew month name (from the month index).
 * @param monthIndex  Index in HEBREW_MONTH_NAMES (0 = Elul/Sep, 11 = Av/Aug)
 */
export function getHebrewMonthLabel(monthIndex: number): string {
  return HEBREW_MONTH_NAMES[monthIndex] ?? "";
}

/**
 * Convert a Gregorian month (1–12) to its Hebrew display name.
 */
export function gregorianMonthToHebrew(month: number): string {
  // Academic year order: Sep=0, Oct=1, Nov=2, Dec=3, Jan=4, …, Aug=11
  const idx = month >= 9 ? month - 9 : month + 3;
  return HEBREW_MONTH_NAMES[idx] ?? String(month);
}

// ──────────────────────────────────────────────
// Family data processing
// ──────────────────────────────────────────────

export interface ImportChild {
  first_name: string;
  last_name: string;
  hebrew_name: string | null;
  date_of_birth: string | null;
  monthly_tuition: number;
  notes: string | null;
}

export interface ImportFamily {
  name: string;
  father_name: string | null;
  mother_name: string | null;
  hebrew_name: string | null;
  hebrew_father_name: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  rijksregister: string | null;
  notes: string | null;
  children: ImportChild[];
  /** Original Excel row numbers (1-based) for error reporting */
  sourceRows: number[];
}

/**
 * Process raw Excel rows into structured ImportFamily records.
 *
 * @param rows      Excel data rows (each is an array of cell values)
 * @param mappings  Column index → field key
 * @param academicYear  Used for enrollment date
 */
export function processFamilyRows(
  rows: unknown[][],
  mappings: Record<number, string>
): { families: ImportFamily[]; errors: Array<{ row: number; message: string }> } {
  const familyMap = new Map<string, ImportFamily>();
  const errors: Array<{ row: number; message: string }> = [];

  rows.forEach((row, rowIdx) => {
    const excelRow = rowIdx + 2; // +1 for header, +1 for 1-based
    const get = (key: string): string => {
      const col = Object.entries(mappings).find(([, v]) => v === key)?.[0];
      if (col == null) return "";
      const val = row[parseInt(col)];
      return val == null ? "" : String(val).trim();
    };

    const familyName = get("family_name");
    if (!familyName) {
      // Skip completely empty rows silently
      const hasAnyData = row.some((c) => c != null && String(c).trim() !== "");
      if (hasAnyData) errors.push({ row: excelRow, message: "Missing family name" });
      return;
    }

    const fatherName = get("father_name") || null;
    const key = fatherName ? `${familyName.toLowerCase()}|${fatherName.toLowerCase()}` : familyName.toLowerCase();
    if (!familyMap.has(key)) {
      familyMap.set(key, {
        name: familyName,
        father_name: fatherName,
        mother_name: get("mother_name") || null,
        hebrew_name: get("hebrew_family_name") || null,
        hebrew_father_name: get("hebrew_father_name") || null,
        address: get("address") || null,
        city: get("city") || null,
        postal_code: get("postal_code") || null,
        phone: get("phone") || null,
        email: get("email") || null,
        rijksregister: get("rijksregister") || null,
        notes: get("notes") || null,
        children: [],
        sourceRows: [],
      });
    }

    const family = familyMap.get(key)!;
    family.sourceRows.push(excelRow);

    // Update family contact fields if we have better data now
    if (!family.father_name) family.father_name = get("father_name") || null;
    if (!family.mother_name) family.mother_name = get("mother_name") || null;
    if (!family.hebrew_name) family.hebrew_name = get("hebrew_family_name") || null;
    if (!family.hebrew_father_name) family.hebrew_father_name = get("hebrew_father_name") || null;
    if (!family.address) family.address = get("address") || null;
    if (!family.city) family.city = get("city") || null;
    if (!family.postal_code) family.postal_code = get("postal_code") || null;
    if (!family.phone) family.phone = get("phone") || null;
    if (!family.email) family.email = get("email") || null;

    // Add child entry if first name is provided
    const childFirstName = get("child_first_name");
    if (childFirstName) {
      const lastName = get("child_last_name") || familyName;
      const hebrewName = get("child_hebrew_name") || null;
      const dob = parseEuropeanDate(get("child_dob"));
      const tuition = parseAmount(get("monthly_tuition")) ?? 0;
      const rijks = get("rijksregister");

      family.children.push({
        first_name: childFirstName,
        last_name: lastName,
        hebrew_name: hebrewName,
        date_of_birth: dob,
        monthly_tuition: tuition,
        notes: rijks ? `Rijksregister: ${rijks}` : null,
      });
    }
  });

  return { families: Array.from(familyMap.values()), errors };
}

// ──────────────────────────────────────────────
// Payment data processing
// ──────────────────────────────────────────────

export interface ImportPayment {
  family_name: string;
  month: number;
  year: number;
  payment_date: string | null;
  payment_method: PaymentMethod;
  amount: number;
  currency: string;
  notes: string | null;
  sourceRow: number;
}

/**
 * Process raw Excel rows into ImportPayment records.
 * @param rows  Excel data rows
 * @param familyNameCol  Column index of the family name
 * @param monthGroups  Detected month column groups
 */
export function processPaymentRows(
  rows: unknown[][],
  familyNameCol: number,
  monthGroups: PaymentMonthGroup[]
): { payments: ImportPayment[]; errors: Array<{ row: number; message: string }> } {
  const payments: ImportPayment[] = [];
  const errors: Array<{ row: number; message: string }> = [];

  rows.forEach((row, rowIdx) => {
    const excelRow = rowIdx + 2;
    const familyName = row[familyNameCol];
    if (familyName == null || String(familyName).trim() === "") return;
    const name = String(familyName).trim();

    for (const grp of monthGroups) {
      const rawAmount = row[grp.amountCol];
      const amount = parseAmount(rawAmount);
      if (!amount) continue; // skip empty/zero months

      const rawDate = row[grp.dateCol];
      const rawMethod = row[grp.methodCol];

      const paymentDate = parseEuropeanDate(rawDate);
      const method = normalizePaymentMethod(rawMethod);
      const currency = detectCurrency(rawAmount);

      payments.push({
        family_name: name,
        month: grp.month,
        year: grp.year,
        payment_date: paymentDate,
        payment_method: method,
        amount,
        currency,
        notes: null,
        sourceRow: excelRow,
      });
    }
  });

  return { payments, errors };
}
