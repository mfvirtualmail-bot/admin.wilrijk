"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import {
  parseExcelFile,
  suggestPaymentMappings,
  processPaymentRows,
  gregorianMonthToHebrew,
  type PaymentMonthGroup,
  type ImportPayment,
} from "@/lib/excel-utils";
import { ACADEMIC_MONTHS, CURRENCY_SYMBOLS } from "@/lib/payment-utils";
import { usePaymentMethods } from "@/lib/use-settings";

type WizardStep = "upload" | "map" | "match" | "preview" | "importing" | "done";

function defaultAcademicYear(): number {
  const now = new Date();
  return now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

function buildYearOptions(): number[] {
  const cur = defaultAcademicYear();
  return [cur + 1, cur, cur - 1, cur - 2, cur - 3];
}

/** Generate all {month, year} combinations for an academic year (Sep→Aug) */
function buildMonthOptions(academicYear: number) {
  return ACADEMIC_MONTHS.map((m) => {
    const year = m >= 9 ? academicYear : academicYear + 1;
    return { month: m, year, label: `${gregorianMonthToHebrew(m)} ${year}` };
  });
}


export default function PaymentsImportPage() {
  const { methodLabels } = usePaymentMethods();
  const [step, setStep] = useState<WizardStep>("upload");
  const [academicYear, setAcademicYear] = useState(defaultAcademicYear());

  // Excel parse result
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);

  // Detected structure
  const [familyNameCol, setFamilyNameCol] = useState<number>(0);
  const [monthGroups, setMonthGroups] = useState<PaymentMonthGroup[]>([]);

  // Processed data
  const [payments, setPayments] = useState<ImportPayment[]>([]);
  const [parseErrors, setParseErrors] = useState<Array<{ row: number; message: string }>>([]);

  // Family matching: name → db family id (populated from API)
  const [dbFamilies, setDbFamilies] = useState<{ id: string; name: string; father_name: string | null }[]>([]);
  const [familyMatchOverrides, setFamilyMatchOverrides] = useState<Record<string, string>>({}); // excel-name → family-id or ""

  // Import result
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
    errors: Array<{ row: number; family: string; message: string }>;
  } | null>(null);

  const [fileError, setFileError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const workbookRef = useRef<{
    sheetNames: string[];
    getSheet: (name: string) => { headers: string[]; rows: unknown[][] };
  } | null>(null);

  // ── Step 1: File upload ──

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError("");
    try {
      const wb = await parseExcelFile(file);
      workbookRef.current = wb;
      setSheetNames(wb.sheetNames);
      const sheet = wb.sheetNames[0] ?? "";
      setSelectedSheet(sheet);
      const parsed = wb.getSheet(sheet);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      const suggested = suggestPaymentMappings(parsed.headers, academicYear);
      setFamilyNameCol(suggested.familyNameCol);
      setMonthGroups(suggested.monthGroups);
    } catch {
      setFileError("Could not read the file. Please make sure it is a valid Excel file (.xlsx, .xls) or CSV.");
    }
  }

  function handleSheetChange(name: string) {
    setSelectedSheet(name);
    if (!workbookRef.current) return;
    const parsed = workbookRef.current.getSheet(name);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    const suggested = suggestPaymentMappings(parsed.headers, academicYear);
    setFamilyNameCol(suggested.familyNameCol);
    setMonthGroups(suggested.monthGroups);
  }

  const monthOptions = buildMonthOptions(academicYear);

  function updateMonthGroup(idx: number, patch: Partial<PaymentMonthGroup>) {
    setMonthGroups((prev) => prev.map((g, i) => (i === idx ? { ...g, ...patch } : g)));
  }

  function removeMonthGroup(idx: number) {
    setMonthGroups((prev) => prev.filter((_, i) => i !== idx));
  }

  function addMonthGroup() {
    const usedCols = new Set([
      familyNameCol,
      ...monthGroups.flatMap((g) => [g.dateCol, g.methodCol, g.amountCol]),
    ]);
    const nextFree = headers.findIndex((_, i) => !usedCols.has(i) && i > familyNameCol);
    if (nextFree === -1 || nextFree + 2 >= headers.length) return;
    const firstUnused = monthOptions.find(
      (o) => !monthGroups.some((g) => g.month === o.month && g.year === o.year)
    );
    if (!firstUnused) return;
    setMonthGroups((prev) => [
      ...prev,
      {
        dateCol: nextFree,
        methodCol: nextFree + 1,
        amountCol: nextFree + 2,
        month: firstUnused.month,
        year: firstUnused.year,
      },
    ]);
  }

  async function goToMatch() {
    const { payments: pms, errors: errs } = processPaymentRows(rows, familyNameCol, monthGroups);
    setPayments(pms);
    setParseErrors(errs);

    // Load DB families for matching
    try {
      const res = await fetch("/api/families");
      const data = await res.json();
      if (data.families) {
        setDbFamilies(data.families);
        // Auto-match
        const overrides: Record<string, string> = {};
        const uniqueNames = Array.from(new Set(pms.map((p) => p.family_name)));
        uniqueNames.forEach((name) => {
          const match = (data.families as { id: string; name: string; father_name: string | null }[]).find(
            (f) => f.name.toLowerCase().trim() === name.toLowerCase().trim()
          );
          overrides[name] = match?.id ?? "";
        });
        setFamilyMatchOverrides(overrides);
      }
    } catch {
      // Proceed without pre-matching
    }

    setStep("match");
  }

  // ── Step 3: Family matching → preview ──

  function goToPreview() {
    setStep("preview");
  }

  const uniqueExcelNames = Array.from(new Set(payments.map((p) => p.family_name))).sort();
  const unmatchedCount = uniqueExcelNames.filter((n) => !familyMatchOverrides[n]).length;

  // ── Step 4: Import ──

  async function handleImport() {
    // Resolve family names to IDs in the payment list
    const resolvedPayments = payments
      .map((p) => ({
        ...p,
        family_name: p.family_name,
        family_id: familyMatchOverrides[p.family_name] || undefined,
      }))
      .filter((p) => p.family_id); // only send matched payments


    setStep("importing");
    try {
      const res = await fetch("/api/payments/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payments: resolvedPayments }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Import failed");
        setStep("preview");
      } else {
        setImportResult(data);
        setStep("done");
      }
    } catch {
      alert("Network error during import");
      setStep("preview");
    }
  }

  const sampleRows = rows.slice(0, 3);
  const colLabel = (i: number) => String.fromCharCode(65 + i);
  const monthLabel = (m: number, y: number) =>
    monthOptions.find((o) => o.month === m && o.year === y)?.label ?? `${m}/${y}`;

  return (
    <div>
      <Header titleKey="page.payments" />
      <div className="p-6 max-w-6xl">
        <Link href="/payments" className="text-sm text-blue-600 hover:underline mb-4 block">
          ← Back to Payments
        </Link>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Import Payments from Excel</h2>
          <p className="text-sm text-gray-500 mb-6">
            Upload your payment history Excel file. You will map the columns to months and verify family matches.
          </p>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-8 text-sm flex-wrap">
            {(["upload", "map", "match", "preview"] as const).map((s, i) => {
              const labels = ["1. Upload", "2. Map Columns", "3. Match Families", "4. Preview & Import"];
              const stepOrder = ["upload", "map", "match", "preview", "importing", "done"];
              const curIdx = stepOrder.indexOf(step);
              const sIdx = stepOrder.indexOf(s);
              const active = step === s;
              const past = curIdx > sIdx;
              return (
                <div key={s} className="flex items-center gap-2">
                  {i > 0 && <div className="w-6 h-px bg-gray-300" />}
                  <span
                    className={`px-3 py-1 rounded-full font-medium whitespace-nowrap ${
                      active
                        ? "bg-blue-600 text-white"
                        : past
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {labels[i]}
                  </span>
                </div>
              );
            })}
          </div>

          {/* ── STEP 1: UPLOAD ── */}
          {step === "upload" && (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Academic Year</label>
                  <select
                    value={academicYear}
                    onChange={(e) => setAcademicYear(Number(e.target.value))}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {buildYearOptions().map((y) => (
                      <option key={y} value={y}>
                        {y}/{y + 1}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    The academic year the payments in this file belong to.
                  </p>
                </div>

                <div className="max-w-md">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Currency</label>
                  <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-800">
                    <strong>Auto-detected per cell.</strong> Cells prefixed with £ or $
                    are imported as GBP / USD; everything else is treated as EUR.
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Excel File (.xlsx, .xls, .csv)
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-10 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
                >
                  <div className="text-4xl mb-3">📂</div>
                  <p className="text-gray-700 font-medium text-base">Click to choose a file</p>
                  <p className="text-gray-400 text-sm mt-1">or drag and drop here</p>
                  {headers.length > 0 && (
                    <p className="text-green-600 text-sm mt-3 font-medium">
                      ✓ File loaded — {headers.length} columns, {rows.length} rows
                      {monthGroups.length > 0 && ` · ${monthGroups.length} months detected`}
                    </p>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              {fileError && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
                  {fileError}
                </div>
              )}

              {sheetNames.length > 1 && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Select Sheet</label>
                  <select
                    value={selectedSheet}
                    onChange={(e) => handleSheetChange(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {sheetNames.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep("map")}
                  disabled={!headers.length}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-semibold text-sm disabled:opacity-40"
                >
                  Next: Map Columns →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: COLUMN MAPPING ── */}
          {step === "map" && (
            <div className="space-y-6">
              <p className="text-sm text-gray-600">
                The system detected the structure below. Each row in your Excel has a family name,
                then groups of 3 columns for each month: <strong>Date</strong>, <strong>Payment Method (COM)</strong>,
                and <strong>Amount</strong>. Please verify the month assignments.
              </p>

              {/* Family name column selector */}
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Family Name Column
                </label>
                <select
                  value={familyNameCol}
                  onChange={(e) => setFamilyNameCol(Number(e.target.value))}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      Column {colLabel(i)}{h ? `: ${h}` : ""}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Preview: {sampleRows.map((r) => String((r as unknown[])[familyNameCol] ?? "")).filter(Boolean).slice(0, 3).join(", ")}
                </p>
              </div>

              {/* Month groups */}
              <div>
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">
                    Month Column Groups ({monthGroups.length} detected)
                  </h3>
                  <button
                    onClick={addMonthGroup}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    + Add Month Group
                  </button>
                </div>

                <div className="space-y-3">
                  {monthGroups.map((grp, gi) => (
                    <div
                      key={gi}
                      className="border border-gray-200 rounded-lg p-4 bg-white flex flex-wrap gap-4 items-end"
                    >
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Month</label>
                        <select
                          value={`${grp.month}:${grp.year}`}
                          onChange={(e) => {
                            const [m, y] = e.target.value.split(":");
                            updateMonthGroup(gi, { month: parseInt(m), year: parseInt(y) });
                          }}
                          className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {monthOptions.map((o) => (
                            <option key={`${o.month}:${o.year}`} value={`${o.month}:${o.year}`}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {(["dateCol", "methodCol", "amountCol"] as const).map((field, fi) => {
                        const labels = ["Date column", "Method column", "Amount column"];
                        return (
                          <div key={field}>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              {labels[fi]}
                            </label>
                            <select
                              value={grp[field]}
                              onChange={(e) => updateMonthGroup(gi, { [field]: parseInt(e.target.value) })}
                              className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value={-1}>— Skip —</option>
                              {headers.map((h, hi) => (
                                <option key={hi} value={hi}>
                                  Col {colLabel(hi)}{h ? `: ${h}` : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}

                      {/* Preview row values */}
                      <div className="text-xs text-gray-500 flex gap-3">
                        {sampleRows.slice(0, 1).map((r, ri) => {
                          const row = r as unknown[];
                          return (
                            <span key={ri}>
                              Sample: {String(row[grp.dateCol] ?? "—")} |{" "}
                              {String(row[grp.methodCol] ?? "—")} |{" "}
                              {String(row[grp.amountCol] ?? "—")}
                            </span>
                          );
                        })}
                      </div>

                      <button
                        onClick={() => removeMonthGroup(gi)}
                        className="text-red-400 hover:text-red-600 text-xs ml-auto"
                      >
                        Remove
                      </button>
                    </div>
                  ))}

                  {monthGroups.length === 0 && (
                    <div className="text-center py-6 text-gray-400 text-sm border border-dashed border-gray-300 rounded-lg">
                      No month groups detected. Click &quot;+ Add Month Group&quot; to add one manually.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep("upload")}
                  className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium text-sm"
                >
                  ← Back
                </button>
                <button
                  onClick={goToMatch}
                  disabled={monthGroups.length === 0}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-semibold text-sm disabled:opacity-40"
                >
                  Next: Match Families →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3: FAMILY MATCHING ── */}
          {step === "match" && (
            <div className="space-y-5">
              <p className="text-sm text-gray-600">
                The system tried to match the family names from your Excel to the families in the database.
                Please review and fix any unmatched families (shown in red).
                Families without a match will be skipped.
              </p>

              {/* Summary */}
              <div className="flex gap-4 text-sm">
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-blue-800">
                  <div className="text-2xl font-bold">{uniqueExcelNames.length}</div>
                  <div>Families in file</div>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-green-800">
                  <div className="text-2xl font-bold">{uniqueExcelNames.length - unmatchedCount}</div>
                  <div>Matched</div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-800">
                  <div className="text-2xl font-bold">{unmatchedCount}</div>
                  <div>Unmatched (will skip)</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-gray-800">
                  <div className="text-2xl font-bold">{payments.length}</div>
                  <div>Payment records</div>
                </div>
              </div>

              {/* Family matching table */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Name in Excel</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Match in Database</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Payments</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {uniqueExcelNames.map((name) => {
                      const matched = familyMatchOverrides[name];
                      const count = payments.filter((p) => p.family_name === name).length;
                      return (
                        <tr
                          key={name}
                          className={matched ? "bg-white" : "bg-red-50"}
                        >
                          <td className="px-4 py-3 font-medium">
                            {!matched && <span className="text-red-500 mr-1">⚠</span>}
                            {name}
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={matched ?? ""}
                              onChange={(e) =>
                                setFamilyMatchOverrides((prev) => ({
                                  ...prev,
                                  [name]: e.target.value,
                                }))
                              }
                              className={`px-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px] ${
                                matched
                                  ? "border-gray-300 bg-white"
                                  : "border-red-300 bg-red-50"
                              }`}
                            >
                              <option value="">— Skip this family —</option>
                              {dbFamilies.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.father_name ? `${f.name} (${f.father_name})` : f.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{count} payments</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {parseErrors.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm font-semibold text-yellow-800 mb-2">
                    {parseErrors.length} rows could not be parsed:
                  </p>
                  <ul className="text-xs text-yellow-700 space-y-1 max-h-24 overflow-y-auto">
                    {parseErrors.map((e, i) => (
                      <li key={i}>Row {e.row}: {e.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep("map")}
                  className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium text-sm"
                >
                  ← Back
                </button>
                <button
                  onClick={goToPreview}
                  disabled={payments.length === 0}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-semibold text-sm disabled:opacity-40"
                >
                  Next: Preview Payments →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 4: PREVIEW ── */}
          {step === "preview" && (
            <div className="space-y-5">
              {/* Summary */}
              <div className="flex gap-4 text-sm flex-wrap">
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-green-800">
                  <div className="text-2xl font-bold">
                    {payments.filter((p) => familyMatchOverrides[p.family_name]).length}
                  </div>
                  <div>Payments to import</div>
                </div>
                {unmatchedCount > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-yellow-800">
                    <div className="text-2xl font-bold">
                      {payments.filter((p) => !familyMatchOverrides[p.family_name]).length}
                    </div>
                    <div>Payments skipped (unmatched families)</div>
                  </div>
                )}
              </div>

              {/* Preview table */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 border-b border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600">
                  Preview (first 30 payments)
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600">Family</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600">Month</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600">Date</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600">Method</th>
                        <th className="text-right px-4 py-2 font-semibold text-gray-600">Amount</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {payments.slice(0, 30).map((p, i) => {
                        const matched = !!familyMatchOverrides[p.family_name];
                        return (
                          <tr
                            key={i}
                            className={matched ? "hover:bg-gray-50" : "bg-red-50 opacity-60"}
                          >
                            <td className="px-4 py-2 font-medium text-gray-900">{p.family_name}</td>
                            <td className="px-4 py-2 text-gray-600" dir="rtl">
                              {monthLabel(p.month, p.year)}
                            </td>
                            <td className="px-4 py-2 text-gray-600">
                              {p.payment_date ?? <span className="text-gray-400 italic text-xs">No date</span>}
                            </td>
                            <td className="px-4 py-2">
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                                {methodLabels[p.payment_method] ?? p.payment_method}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right font-semibold text-gray-900">
                              {CURRENCY_SYMBOLS[p.currency]}{p.amount.toFixed(2)}
                            </td>
                            <td className="px-4 py-2">
                              {matched ? (
                                <span className="text-green-600 text-xs">✓ Ready</span>
                              ) : (
                                <span className="text-red-500 text-xs">✗ Skipped</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {payments.length > 30 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-2 text-center text-gray-400 text-xs">
                            … and {payments.length - 30} more payment records
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep("match")}
                  className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium text-sm"
                >
                  ← Back
                </button>
                <button
                  onClick={handleImport}
                  disabled={payments.filter((p) => familyMatchOverrides[p.family_name]).length === 0}
                  className="px-6 py-2.5 bg-green-600 text-white rounded-md hover:bg-green-700 font-bold text-sm disabled:opacity-40"
                >
                  Import {payments.filter((p) => familyMatchOverrides[p.family_name]).length} Payments
                </button>
              </div>
            </div>
          )}

          {/* ── IMPORTING ── */}
          {step === "importing" && (
            <div className="text-center py-12">
              <div className="text-4xl mb-4 animate-pulse">⏳</div>
              <p className="text-lg font-semibold text-gray-700">Importing payments…</p>
              <p className="text-sm text-gray-500 mt-2">Please wait, do not close this page.</p>
            </div>
          )}

          {/* ── DONE ── */}
          {step === "done" && importResult && (
            <div className="space-y-5">
              <div className="text-center">
                <div className="text-5xl mb-3">✅</div>
                <h3 className="text-xl font-bold text-gray-900">Import Complete!</h3>
              </div>

              <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto">
                {[
                  { label: "Payments imported", value: importResult.imported, color: "text-green-700" },
                  { label: "Skipped (empty)", value: importResult.skipped, color: "text-gray-600" },
                  { label: "Errors", value: importResult.errors.length, color: "text-red-600" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-gray-50 rounded-lg border border-gray-200 p-4 text-center">
                    <div className={`text-3xl font-bold ${color}`}>{value}</div>
                    <div className="text-xs text-gray-500 mt-1">{label}</div>
                  </div>
                ))}
              </div>

              {importResult.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm font-semibold text-red-800 mb-2">Errors:</p>
                  <ul className="text-xs text-red-700 space-y-1 max-h-32 overflow-y-auto">
                    {importResult.errors.map((e, i) => (
                      <li key={i}>{e.family}: {e.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-3 justify-center">
                <Link
                  href="/payments"
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-semibold text-sm"
                >
                  View All Payments
                </Link>
                <button
                  onClick={() => {
                    setStep("upload");
                    setHeaders([]);
                    setRows([]);
                    setPayments([]);
                    setMonthGroups([]);
                    setParseErrors([]);
                    setImportResult(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium text-sm"
                >
                  Import Another File
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
