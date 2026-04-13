"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import {
  parseExcelFile,
  suggestFamilyMappings,
  processFamilyRows,
  FAMILY_FIELDS,
  type ImportFamily,
} from "@/lib/excel-utils";

type WizardStep = "upload" | "map" | "preview" | "importing" | "done";

// Current academic year based on today
function defaultAcademicYear(): number {
  const now = new Date();
  return now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

function buildYearOptions(): number[] {
  const cur = defaultAcademicYear();
  return [cur + 1, cur, cur - 1, cur - 2, cur - 3];
}

export default function FamiliesImportPage() {
  const [step, setStep] = useState<WizardStep>("upload");
  const [academicYear, setAcademicYear] = useState(defaultAcademicYear());
  const [mode, setMode] = useState<"skip_existing" | "update_existing">("skip_existing");

  // Excel parse result
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);

  // Column mappings: col index → field key
  const [mappings, setMappings] = useState<Record<number, string>>({});

  // Processed data
  const [families, setFamilies] = useState<ImportFamily[]>([]);
  const [parseErrors, setParseErrors] = useState<Array<{ row: number; message: string }>>([]);

  // Import result
  const [importResult, setImportResult] = useState<{
    created: { families: number; children: number };
    updated: { families: number };
    skipped: number;
    errors: Array<{ row: number; message: string }>;
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
      setMappings(suggestFamilyMappings(parsed.headers));
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
    setMappings(suggestFamilyMappings(parsed.headers));
  }

  function goToMap() {
    if (!headers.length) { setFileError("Please upload a file first."); return; }
    setStep("map");
  }

  // ── Step 2: Column mapping ──

  function setMapping(colIdx: number, value: string) {
    setMappings((prev) => ({ ...prev, [colIdx]: value }));
  }

  const requiredMapped = Object.values(mappings).includes("family_name");

  function goToPreview() {
    const { families: fams, errors: errs } = processFamilyRows(rows, mappings);
    setFamilies(fams);
    setParseErrors(errs);
    setStep("preview");
  }

  // ── Step 4: Import ──

  async function handleImport() {

    setStep("importing");
    try {
      const res = await fetch("/api/families/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ families, mode }),
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

  // ── Render helpers ──

  const sampleRows = rows.slice(0, 4);

  return (
    <div>
      <Header titleKey="page.families" />
      <div className="p-6 max-w-5xl">
        <Link href="/families" className="text-sm text-blue-600 hover:underline mb-4 block">
          ← Back to Families
        </Link>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Import Families from Excel</h2>
          <p className="text-sm text-gray-500 mb-6">
            Upload your student list Excel file. You will be able to choose which column contains which information.
          </p>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-8 text-sm">
            {(["upload", "map", "preview"] as const).map((s, i) => {
              const labels = ["1. Upload File", "2. Map Columns", "3. Preview & Import"];
              const active = step === s || (step === "importing" && s === "preview") || (step === "done" && s === "preview");
              const past =
                (s === "upload" && ["map", "preview", "importing", "done"].includes(step)) ||
                (s === "map" && ["preview", "importing", "done"].includes(step));
              return (
                <div key={s} className="flex items-center gap-2">
                  {i > 0 && <div className="w-8 h-px bg-gray-300" />}
                  <span
                    className={`px-3 py-1 rounded-full font-medium ${
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
              {/* Year selector */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Academic Year
                </label>
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
                  This is used to set enrollment dates for new students.
                </p>
              </div>

              {/* File upload */}
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

              {/* Sheet selector */}
              {sheetNames.length > 1 && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Select Sheet
                  </label>
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
                  onClick={goToMap}
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
            <div className="space-y-5">
              <p className="text-sm text-gray-600">
                For each column in your Excel file, choose what information it contains.
                The system has made suggestions — please review and adjust as needed.
              </p>

              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="text-sm w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      {headers.map((h, i) => (
                        <th key={i} className="px-3 py-3 text-left font-semibold text-gray-700 whitespace-nowrap min-w-[160px]">
                          <div className="text-xs text-gray-400 mb-1 font-normal">
                            Column {String.fromCharCode(65 + i)}
                          </div>
                          <div className="mb-2 truncate max-w-[150px]" title={h}>
                            {h || <span className="text-gray-400 italic">(no header)</span>}
                          </div>
                          <select
                            value={mappings[i] ?? "skip"}
                            onChange={(e) => setMapping(i, e.target.value)}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          >
                            {FAMILY_FIELDS.map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sampleRows.map((row, ri) => (
                      <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                        {headers.map((_, ci) => {
                          const val = (row as unknown[])[ci];
                          const mapped = mappings[ci];
                          const isSkip = !mapped || mapped === "skip";
                          return (
                            <td
                              key={ci}
                              className={`px-3 py-2 text-gray-700 text-xs truncate max-w-[150px] ${
                                isSkip ? "text-gray-300" : "bg-green-50"
                              }`}
                              title={val != null ? String(val) : ""}
                            >
                              {val != null ? String(val) : ""}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!requiredMapped && (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-md p-3 text-sm">
                  Please map at least one column to <strong>Family Name</strong> to continue.
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep("upload")}
                  className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium text-sm"
                >
                  ← Back
                </button>
                <button
                  onClick={goToPreview}
                  disabled={!requiredMapped}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-semibold text-sm disabled:opacity-40"
                >
                  Next: Preview Data →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3: PREVIEW ── */}
          {step === "preview" && (
            <div className="space-y-5">
              {/* Summary */}
              <div className="flex gap-4 text-sm">
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-blue-800">
                  <div className="text-2xl font-bold">{families.length}</div>
                  <div>Families to import</div>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-green-800">
                  <div className="text-2xl font-bold">
                    {families.reduce((s, f) => s + f.children.length, 0)}
                  </div>
                  <div>Children to import</div>
                </div>
                {parseErrors.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-800">
                    <div className="text-2xl font-bold">{parseErrors.length}</div>
                    <div>Rows with errors</div>
                  </div>
                )}
              </div>

              {/* Import mode */}
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <p className="text-sm font-semibold text-gray-700 mb-3">
                  What to do with families that already exist in the database?
                </p>
                <div className="flex flex-col gap-2">
                  {[
                    { value: "skip_existing", label: "Skip existing families (safe — only add new ones)" },
                    { value: "update_existing", label: "Update existing families (overwrites contact info)" },
                  ].map((opt) => (
                    <label key={opt.value} className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="mode"
                        value={opt.value}
                        checked={mode === opt.value}
                        onChange={() => setMode(opt.value as typeof mode)}
                        className="w-4 h-4 text-blue-600"
                      />
                      <span className="text-sm text-gray-700">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Errors */}
              {parseErrors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm font-semibold text-red-800 mb-2">Rows with issues (will be skipped):</p>
                  <ul className="text-xs text-red-700 space-y-1 max-h-32 overflow-y-auto">
                    {parseErrors.map((e, i) => (
                      <li key={i}>Row {e.row}: {e.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Preview table */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 border-b border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600">
                  Preview (first 20 families)
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600">Family Name</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600">Father</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600">City</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600">Phone</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600">Email</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600">Children</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {families.slice(0, 20).map((f, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium text-gray-900">{f.name}</td>
                          <td className="px-4 py-2 text-gray-600">{f.father_name ?? "—"}</td>
                          <td className="px-4 py-2 text-gray-600">{f.city ?? "—"}</td>
                          <td className="px-4 py-2 text-gray-600">{f.phone ?? "—"}</td>
                          <td className="px-4 py-2 text-gray-600">{f.email ?? "—"}</td>
                          <td className="px-4 py-2">
                            {f.children.length > 0 ? (
                              <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-medium">
                                {f.children.length} {f.children.length === 1 ? "child" : "children"}:{" "}
                                {f.children.map((c) => c.first_name).join(", ")}
                              </span>
                            ) : (
                              <span className="text-gray-400 text-xs">No children</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {families.length > 20 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-2 text-center text-gray-400 text-xs">
                            … and {families.length - 20} more families
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep("map")}
                  className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium text-sm"
                >
                  ← Back
                </button>
                <button
                  onClick={handleImport}
                  disabled={families.length === 0}
                  className="px-6 py-2.5 bg-green-600 text-white rounded-md hover:bg-green-700 font-bold text-sm disabled:opacity-40"
                >
                  Import {families.length} {families.length === 1 ? "Family" : "Families"}
                </button>
              </div>
            </div>
          )}

          {/* ── IMPORTING ── */}
          {step === "importing" && (
            <div className="text-center py-12">
              <div className="text-4xl mb-4 animate-pulse">⏳</div>
              <p className="text-lg font-semibold text-gray-700">Importing data…</p>
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

              <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto">
                {[
                  { label: "Families created", value: importResult.created.families, color: "text-green-700" },
                  { label: "Children added", value: importResult.created.children, color: "text-green-700" },
                  { label: "Families updated", value: importResult.updated.families, color: "text-blue-700" },
                  { label: "Families skipped", value: importResult.skipped, color: "text-gray-600" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-gray-50 rounded-lg border border-gray-200 p-4 text-center">
                    <div className={`text-3xl font-bold ${color}`}>{value}</div>
                    <div className="text-xs text-gray-500 mt-1">{label}</div>
                  </div>
                ))}
              </div>

              {importResult.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm font-semibold text-red-800 mb-2">
                    {importResult.errors.length} errors occurred:
                  </p>
                  <ul className="text-xs text-red-700 space-y-1 max-h-32 overflow-y-auto">
                    {importResult.errors.map((e, i) => (
                      <li key={i}>{e.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-3 justify-center">
                <Link
                  href="/families"
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-semibold text-sm"
                >
                  View All Families
                </Link>
                <button
                  onClick={() => {
                    setStep("upload");
                    setHeaders([]);
                    setRows([]);
                    setFamilies([]);
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
