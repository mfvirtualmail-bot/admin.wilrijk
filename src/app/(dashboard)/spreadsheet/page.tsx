"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type ColGroupDef,
  type CellValueChangedEvent,
  type GetRowIdParams,
  type ValueGetterParams,
  type ValueSetterParams,
  themeQuartz,
} from "ag-grid-community";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth-context";
import { METHOD_LABELS, CURRENCY_SYMBOLS, formatCurrency } from "@/lib/payment-utils";
import { academicYearLabel } from "@/lib/hebrew-date";
import type { PaymentMethod, Currency } from "@/lib/types";

ModuleRegistry.registerModules([AllCommunityModule]);

// AG Grid theme with large fonts for accessibility
const gridTheme = themeQuartz.withParams({
  fontSize: 15,
  rowHeight: 38,
  headerHeight: 40,
  headerFontSize: 13,
  headerFontWeight: 600,
});

const METHODS = Object.keys(METHOD_LABELS) as PaymentMethod[];

interface MonthMeta { month: number; year: number; key: string; hebrewLabel: string }

interface SpreadsheetRow {
  familyId: string;
  familyName: string;
  baseCurrency: Currency;
  monthlyTuition: number;
  totalCharged: number;
  totalPaid: number;
  balance: number;
  [key: string]: unknown;
}

interface CellData {
  paymentId: string | null;
  date: string | null;
  method: string | null;
  amount: number | null;
  currency: Currency | null;
  notes: string | null;
}

function formatDateShort(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}-${mm}-${yy}`;
}

export default function SpreadsheetPage() {
  const { user } = useAuth();
  const gridRef = useRef<AgGridReact>(null);

  const [rowData, setRowData] = useState<SpreadsheetRow[]>([]);
  const [months, setMonths] = useState<MonthMeta[]>([]);
  const [academicYear, setAcademicYear] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const canEdit = user?.is_super_admin;

  useEffect(() => {
    fetch("/api/spreadsheet")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setRowData(d.rows);
        setMonths(d.months);
        setAcademicYear(d.academicYear);
      })
      .catch(() => setError("Failed to load spreadsheet data"))
      .finally(() => setLoading(false));
  }, []);

  // Save a cell change to the server, then refetch the whole row set so
  // the FX-converted summary totals (which depend on today's rate) stay
  // authoritative and don't drift against the server's view.
  const saveCell = useCallback(async (
    familyId: string,
    month: number,
    year: number,
    monthKey: string,
    field: "amount" | "method" | "date" | "notes",
    newValue: unknown,
    rowNode: SpreadsheetRow,
  ) => {
    const cellData = (rowNode[monthKey] as CellData) ?? {};
    const updated: CellData = { ...cellData, [field]: newValue };

    setSaveStatus("saving");
    try {
      const res = await fetch("/api/spreadsheet/cell", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyId,
          month,
          year,
          amount: updated.amount,
          method: updated.method || "kas",
          date: updated.date,
          notes: updated.notes,
          paymentId: updated.paymentId,
          currency: updated.currency ?? rowNode.baseCurrency,
        }),
      });
      if (!res.ok) { setSaveStatus("error"); return; }

      const fresh = await fetch("/api/spreadsheet");
      const freshData = await fresh.json();
      if (freshData.rows) setRowData(freshData.rows);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch {
      setSaveStatus("error");
    }
  }, []);

  const onCellValueChanged = useCallback((event: CellValueChangedEvent) => {
    if (!canEdit) return;
    const { colDef, data, newValue, oldValue } = event;
    const field = colDef.field as string;
    if (!field || !field.includes("|")) return;

    // Second line of defence against an invalid amount edit destroying a
    // payment: if the amount field got NaN past the value setter, treat
    // the edit as a no-op (same value as before) so the API call never
    // converts a typo into a delete.
    if (field.endsWith("|amount")) {
      const isExplicitClear = newValue === null || newValue === "" || newValue === undefined;
      const isValidNumber = typeof newValue === "number" && Number.isFinite(newValue);
      if (!isExplicitClear && !isValidNumber) {
        event.node?.setDataValue(colDef.field as string, oldValue);
        return;
      }
    }

    const [monthKey, subField] = field.split("|");
    const [, monthStr, yearStr] = monthKey.split("_");
    const month = Number(monthStr);
    const year = Number(yearStr);

    saveCell(data.familyId, month, year, monthKey, subField as "amount" | "method" | "date" | "notes", newValue, data);
  }, [canEdit, saveCell]);

  // Build column definitions
  const columnDefs = useMemo<(ColDef | ColGroupDef)[]>(() => {
    if (!months.length) return [];

    const cols: (ColDef | ColGroupDef)[] = [
      {
        field: "familyName",
        headerName: "Family",
        pinned: "left",
        width: 170,
        editable: false,
        cellStyle: { fontWeight: "600" },
        filter: true,
      },
    ];

    // One column group per month
    for (const { hebrewLabel, key } of months) {
      const label = hebrewLabel;
      cols.push({
        headerName: label,
        groupId: key,
        children: [
          {
            field: `${key}|date`,
            headerName: "Date",
            width: 95,
            editable: canEdit,
            valueGetter: (p: ValueGetterParams) => {
              const cell = p.data?.[key] as CellData;
              return formatDateShort(cell?.date ?? null);
            },
            valueSetter: (p: ValueSetterParams) => {
              if (!p.data[key]) p.data[key] = { paymentId: null, date: null, method: null, amount: null, notes: null };
              (p.data[key] as CellData).date = p.newValue || null;
              return true;
            },
            cellStyle: (p) => {
              const cell = p.data?.[key] as CellData;
              return cell?.amount ? { color: "#374151" } : { color: "#d1d5db" };
            },
          },
          {
            field: `${key}|method`,
            headerName: "COM",
            width: 90,
            editable: canEdit,
            cellEditor: "agSelectCellEditor",
            cellEditorParams: { values: METHODS },
            valueGetter: (p: ValueGetterParams) => {
              const cell = p.data?.[key] as CellData;
              return cell?.method ?? "";
            },
            valueSetter: (p: ValueSetterParams) => {
              if (!p.data[key]) p.data[key] = { paymentId: null, date: null, method: null, amount: null, notes: null };
              (p.data[key] as CellData).method = p.newValue || null;
              return true;
            },
            cellStyle: (p) => {
              const cell = p.data?.[key] as CellData;
              const method = cell?.method;
              if (!method) return { color: "#d1d5db" };
              const colors: Record<string, string> = {
                crc: "#1d4ed8", kas: "#15803d", bank: "#7e22ce", other: "#6b7280",
              };
              return { color: colors[method] ?? "#374151", fontWeight: "600" };
            },
          },
          {
            field: `${key}|amount`,
            headerName: "Amount",
            width: 95,
            editable: canEdit,
            type: "numericColumn",
            valueGetter: (p: ValueGetterParams) => {
              const cell = p.data?.[key] as CellData;
              return cell?.amount ?? null;
            },
            valueSetter: (p: ValueSetterParams) => {
              if (!p.data[key]) p.data[key] = { paymentId: null, date: null, method: null, amount: null, currency: null, notes: null };
              // An explicit empty clear means "delete this payment"; anything
              // non-numeric (e.g. the user tried to rewrite "$100" as "€100")
              // is rejected so we never silently wipe a payment + its method
              // + its date because of a typo.
              if (p.newValue === "" || p.newValue === null || p.newValue === undefined) {
                (p.data[key] as CellData).amount = null;
                return true;
              }
              const val = Number(p.newValue);
              if (!Number.isFinite(val)) return false;
              (p.data[key] as CellData).amount = val;
              return true;
            },
            valueFormatter: (p) => {
              if (p.value == null) return "";
              const cell = p.data?.[key] as CellData | undefined;
              const cur: Currency = cell?.currency ?? (p.data?.baseCurrency as Currency) ?? "EUR";
              return formatCurrency(Number(p.value), cur);
            },
            cellStyle: (p) => {
              const cell = p.data?.[key] as CellData;
              const monthlyTuition = p.data?.monthlyTuition ?? 0;
              const amount = cell?.amount ?? 0;
              if (!monthlyTuition) return {};
              if (!amount) return { backgroundColor: "#fef2f2", color: "#dc2626" }; // red = unpaid
              if (amount >= monthlyTuition) return { backgroundColor: "#f0fdf4", color: "#16a34a" }; // green = paid
              return { backgroundColor: "#fefce8", color: "#ca8a04" }; // yellow = partial
            },
          },
        ] as ColDef[],
      } as ColGroupDef);
    }

    // Summary columns — always in the family's base currency (the child's
    // tuition currency). Everything paid in a different currency is
    // converted to the base currency at today's FX rate on the server.
    const fmtBase = (p: { value: unknown; data?: { baseCurrency?: Currency } }) => {
      if (p.value == null || p.value === "") return "";
      const cur: Currency = (p.data?.baseCurrency as Currency) ?? "EUR";
      return formatCurrency(Number(p.value), cur);
    };

    cols.push(
      {
        field: "totalCharged",
        headerName: "Charged",
        width: 110,
        pinned: "right",
        editable: false,
        valueFormatter: fmtBase,
        cellStyle: { color: "#374151", fontWeight: "600" },
      },
      {
        field: "totalPaid",
        headerName: "Paid",
        width: 100,
        pinned: "right",
        editable: false,
        valueFormatter: fmtBase,
        cellStyle: { color: "#15803d", fontWeight: "600" },
      },
      {
        field: "balance",
        headerName: "Balance",
        width: 110,
        pinned: "right",
        editable: false,
        valueFormatter: fmtBase,
        cellStyle: (p) => ({
          fontWeight: "700",
          color: (p.value ?? 0) > 0 ? "#dc2626" : (p.value ?? 0) < 0 ? "#15803d" : "#374151",
        }),
      },
    );

    return cols;
  }, [months, canEdit]);

  const defaultColDef = useMemo<ColDef>(() => ({
    sortable: false,
    resizable: true,
    suppressMovable: true,
  }), []);

  const getRowId = useCallback((params: GetRowIdParams) => params.data.familyId, []);

  // Excel export using xlsx library
  async function handleExport() {
    const { utils, writeFile } = await import("xlsx");
    const headers = ["Family", "Currency"];
    for (const { hebrewLabel } of months) {
      headers.push(`${hebrewLabel} Date`, `${hebrewLabel} COM`, `${hebrewLabel} Amount`, `${hebrewLabel} Currency`);
    }
    headers.push("Total Charged", "Total Paid", "Balance");

    const wsData: unknown[][] = [headers];
    for (const row of rowData) {
      const rowArr: unknown[] = [row.familyName, row.baseCurrency];
      for (const { key } of months) {
        const cell = row[key] as CellData;
        rowArr.push(
          formatDateShort(cell?.date ?? null),
          cell?.method ?? "",
          cell?.amount ?? "",
          cell?.currency ?? "",
        );
      }
      rowArr.push(row.totalCharged, row.totalPaid, row.balance);
      wsData.push(rowArr);
    }

    const ws = utils.aoa_to_sheet(wsData);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, `${academicYear}-${academicYear + 1}`);
    writeFile(wb, `tuition-${academicYear}-${academicYear + 1}.xlsx`);
  }

  // Per-currency grand totals. Families whose tuition is in GBP can't be
  // meaningfully summed with EUR families, so we keep one subtotal per
  // currency and render them side-by-side.
  const paidByCur = new Map<Currency, number>();
  const dueByCur = new Map<Currency, number>();
  for (const r of rowData) {
    paidByCur.set(r.baseCurrency, (paidByCur.get(r.baseCurrency) ?? 0) + r.totalPaid);
    dueByCur.set(r.baseCurrency, (dueByCur.get(r.baseCurrency) ?? 0) + Math.max(0, r.balance));
  }
  const fmtTotals = (m: Map<Currency, number>) =>
    Array.from(m.entries())
      .filter(([, v]) => v > 0)
      .map(([cur, v]) => `${CURRENCY_SYMBOLS[cur]}${v.toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
      .join(" · ") || `${CURRENCY_SYMBOLS.EUR}0`;

  return (
    <div className="flex flex-col h-screen">
      <Header titleKey="page.spreadsheet" />

      {/* Toolbar */}
      <div className="flex items-center gap-4 px-4 py-2 bg-white border-b border-gray-200 text-sm flex-wrap">
        <span className="font-semibold text-gray-700" dir="rtl">
          {academicYear ? academicYearLabel(academicYear) : ""}
        </span>
        <span className="text-gray-400">|</span>
        <span className="text-gray-600">{rowData.length} families</span>
        <span className="text-gray-600">Total paid: <strong className="text-green-700">{fmtTotals(paidByCur)}</strong></span>
        <span className="text-gray-600">Total due: <strong className="text-red-600">{fmtTotals(dueByCur)}</strong></span>

        <div className="ml-auto flex items-center gap-3">
          {saveStatus === "saving" && <span className="text-blue-600 text-xs animate-pulse">Saving…</span>}
          {saveStatus === "saved" && <span className="text-green-600 text-xs">Saved ✓</span>}
          {saveStatus === "error" && <span className="text-red-600 text-xs">Save failed!</span>}
          <button
            onClick={handleExport}
            className="px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 text-xs font-medium"
          >
            Export Excel
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-1.5 bg-gray-50 border-b border-gray-200 text-xs text-gray-600">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 border border-green-300 inline-block" /> Paid</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-red-300 inline-block" /> Unpaid</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-300 inline-block" /> Partial</span>
        {canEdit && <span className="text-gray-400">Click any cell to edit · Tab to move · Enter to confirm</span>}
      </div>

      {error && <div className="m-4 bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">{error}</div>}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-lg">Loading spreadsheet…</div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <AgGridReact
            ref={gridRef}
            rowData={rowData}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            theme={gridTheme}
            getRowId={getRowId}
            onCellValueChanged={onCellValueChanged}
            stopEditingWhenCellsLoseFocus
            enableCellTextSelection
            suppressRowClickSelection
            animateRows={false}
          />
        </div>
      )}
    </div>
  );
}
