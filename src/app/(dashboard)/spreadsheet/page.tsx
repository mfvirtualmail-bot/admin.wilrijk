"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type ColGroupDef,
  type GetRowIdParams,
  type ValueGetterParams,
  type ICellRendererParams,
  themeQuartz,
} from "ag-grid-community";
import Header from "@/components/Header";
import AddPaymentModal from "@/components/AddPaymentModal";
import { CURRENCY_SYMBOLS, formatCurrency } from "@/lib/payment-utils";
import { academicYearLabel } from "@/lib/hebrew-date";
import type { Currency } from "@/lib/types";

ModuleRegistry.registerModules([AllCommunityModule]);

const gridTheme = themeQuartz.withParams({
  fontSize: 15,
  rowHeight: 40,
  headerHeight: 40,
  headerFontSize: 13,
  headerFontWeight: 600,
});

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

function AddPaymentButtonRenderer(props: ICellRendererParams & { onAdd: (row: SpreadsheetRow) => void }) {
  const row = props.data as SpreadsheetRow | undefined;
  if (!row) return null;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); props.onAdd(row); }}
      className="w-full h-7 rounded bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
    >
      + €
    </button>
  );
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
  const gridRef = useRef<AgGridReact>(null);

  const [rowData, setRowData] = useState<SpreadsheetRow[]>([]);
  const [months, setMonths] = useState<MonthMeta[]>([]);
  const [academicYear, setAcademicYear] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalFamily, setModalFamily] = useState<SpreadsheetRow | null>(null);

  const loadData = useCallback(() => {
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

  useEffect(() => { loadData(); }, [loadData]);

  // View-only — inline editing removed. Corrections happen via the family detail page
  // or via the "+ Payment" button that opens the floating modal.
  const columnDefs = useMemo<(ColDef | ColGroupDef)[]>(() => {
    if (!months.length) return [];

    const cols: (ColDef | ColGroupDef)[] = [
      {
        headerName: "",
        field: "_addPayment",
        pinned: "left",
        width: 56,
        editable: false,
        sortable: false,
        filter: false,
        cellRenderer: AddPaymentButtonRenderer,
        cellRendererParams: { onAdd: (row: SpreadsheetRow) => setModalFamily(row) },
      },
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

    for (const { hebrewLabel, key } of months) {
      cols.push({
        headerName: hebrewLabel,
        groupId: key,
        children: [
          {
            field: `${key}|date`,
            headerName: "Date",
            width: 95,
            editable: false,
            valueGetter: (p: ValueGetterParams) => {
              const cell = p.data?.[key] as CellData;
              return formatDateShort(cell?.date ?? null);
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
            editable: false,
            valueGetter: (p: ValueGetterParams) => {
              const cell = p.data?.[key] as CellData;
              return cell?.method ?? "";
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
            editable: false,
            type: "numericColumn",
            valueGetter: (p: ValueGetterParams) => {
              const cell = p.data?.[key] as CellData;
              return cell?.amount ?? null;
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
              if (!amount) return { backgroundColor: "#fef2f2", color: "#dc2626" };
              if (amount >= monthlyTuition) return { backgroundColor: "#f0fdf4", color: "#16a34a" };
              return { backgroundColor: "#fefce8", color: "#ca8a04" };
            },
          },
        ] as ColDef[],
      } as ColGroupDef);
    }

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
  }, [months]);

  const defaultColDef = useMemo<ColDef>(() => ({
    sortable: false,
    resizable: true,
    suppressMovable: true,
    editable: false,
  }), []);

  const getRowId = useCallback((params: GetRowIdParams) => params.data.familyId, []);

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

      <div className="flex items-center gap-4 px-4 py-2 bg-white border-b border-gray-200 text-sm flex-wrap">
        <span className="font-semibold text-gray-700" dir="rtl">
          {academicYear ? academicYearLabel(academicYear) : ""}
        </span>
        <span className="text-gray-400">|</span>
        <span className="text-gray-600">{rowData.length} families</span>
        <span className="text-gray-600">Total paid: <strong className="text-green-700">{fmtTotals(paidByCur)}</strong></span>
        <span className="text-gray-600">Total due: <strong className="text-red-600">{fmtTotals(dueByCur)}</strong></span>

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={handleExport}
            className="px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 text-xs font-medium"
          >
            Export Excel
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 px-4 py-1.5 bg-gray-50 border-b border-gray-200 text-xs text-gray-600">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 border border-green-300 inline-block" /> Paid</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-red-300 inline-block" /> Unpaid</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-300 inline-block" /> Partial</span>
        <span className="text-gray-400">View-only — use <strong className="text-blue-700">+ €</strong> to add a payment</span>
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
            enableCellTextSelection
            suppressRowClickSelection
            animateRows={false}
          />
        </div>
      )}

      {modalFamily && (
        <AddPaymentModal
          familyId={modalFamily.familyId}
          familyName={modalFamily.familyName}
          baseCurrency={modalFamily.baseCurrency}
          onClose={() => setModalFamily(null)}
          onSaved={() => { setModalFamily(null); loadData(); }}
        />
      )}
    </div>
  );
}
