"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/payment-utils";
import { usePaymentMethods } from "@/lib/use-settings";
import type { Currency } from "@/lib/types";
import type { StatementMonthRow, PaymentSubline } from "@/lib/statement-data";

interface StatementPayload {
  currency: Currency;
  rows: StatementMonthRow[];
  credit: number;
  totalCharged: number;
  totalPaid: number;
  balanceDue: number;
  statementDate: string;
}

function formatGregorian(iso: string): string {
  const parts = iso.slice(0, 10).split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/** Inline HTML equivalent of the PDF statement — same rows, same FIFO
 *  allocation, same totals. Fetches via /api/families/[id]/statement. */
export default function FamilyStatementView({ familyId }: { familyId: string }) {
  const { methodLabels } = usePaymentMethods();
  const [data, setData] = useState<StatementPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/families/${familyId}/statement`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => !cancelled && setError("Failed to load statement"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [familyId]);

  if (loading) return <p className="text-gray-500 text-sm">Loading statement…</p>;
  if (error) return <p className="text-red-600 text-sm">{error}</p>;
  if (!data) return null;

  const cur = data.currency;
  const fmt = (n: number) => formatCurrency(n, cur);
  const methodName = (m: string) => methodLabels[m] ?? m;

  return (
    <div dir="rtl" className="text-sm">
      {data.rows.length === 0 ? (
        <p className="text-gray-500 italic">No charges or payments to display.</p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-md">
          <table className="w-full">
            <thead className="bg-gray-100 text-gray-700">
              <tr>
                <th className="px-3 py-2 text-right font-semibold">חודש</th>
                <th className="px-3 py-2 text-right font-semibold">פרייז</th>
                <th className="px-3 py-2 text-right font-semibold">באצאלט</th>
                <th className="px-3 py-2 text-right font-semibold">דאטום</th>
                <th className="px-3 py-2 text-right font-semibold">ע&quot;י</th>
                <th className="px-3 py-2 text-right font-semibold">באמערקונג</th>
                <th className="px-3 py-2 text-right font-semibold">נשאר חוב</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.rows.map((r) => (
                <MonthRow
                  key={`${r.year}-${r.month}`}
                  row={r}
                  fmt={fmt}
                  methodName={methodName}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Totals */}
      <div className="mt-4 bg-gray-50 border border-gray-200 rounded-md p-4 space-y-1">
        <TotalsRow label="סך הכל חיוב" value={fmt(data.totalCharged)} />
        <TotalsRow label="סך הכל באַצאָלט" value={fmt(data.totalPaid)} />
        {data.credit > 0 && (
          <TotalsRow label="קרעדיט" value={fmt(data.credit)} muted />
        )}
        <div className="mt-2 pt-2 border-t border-gray-300 flex justify-between">
          <span className="font-bold text-gray-900">נשאר חוב</span>
          <span className={`font-bold ${data.balanceDue > 0 ? "text-red-600" : data.balanceDue < 0 ? "text-green-700" : "text-gray-900"}`}>
            {fmt(data.balanceDue)}
          </span>
        </div>
      </div>
    </div>
  );
}

function MonthRow({
  row, fmt, methodName,
}: {
  row: StatementMonthRow;
  fmt: (n: number) => string;
  methodName: (m: string) => string;
}) {
  const first = row.paymentsApplied[0];
  const rest = row.paymentsApplied.slice(1);
  const projected = row.kind === "projected";
  const bg = projected ? "bg-yellow-50" : "";

  return (
    <>
      <tr className={`${bg} border-t-2 border-gray-200`}>
        <td className="px-3 py-2 font-semibold text-gray-900">
          {row.periodLabel}{projected && <span className="text-xs text-yellow-700 mr-1">(געפּלאַנט)</span>}
        </td>
        <td className="px-3 py-2 text-gray-900">{fmt(row.totalCharge)}</td>
        <td className="px-3 py-2 text-gray-900">{first ? fmt(first.amount) : ""}</td>
        <td className="px-3 py-2 text-gray-600 text-xs">{first ? formatGregorian(first.paymentDate) : ""}</td>
        <td className="px-3 py-2 text-gray-600 text-xs">{first ? methodWithRef(first, methodName) : ""}</td>
        <td className="px-3 py-2 text-gray-500 text-xs">{first?.fxNote ?? ""}</td>
        <td className={`px-3 py-2 font-semibold ${row.residual > 0 ? "text-red-600" : "text-gray-900"}`}>
          {row.residual > 0 ? fmt(-row.residual) : fmt(0)}
        </td>
      </tr>
      {rest.map((p, i) => (
        <tr key={`${p.paymentId}-${i}`} className={`${bg} bg-gray-50/60`}>
          <td className="px-3 py-1.5"></td>
          <td className="px-3 py-1.5"></td>
          <td className="px-3 py-1.5 text-gray-900">{fmt(p.amount)}</td>
          <td className="px-3 py-1.5 text-gray-600 text-xs">{formatGregorian(p.paymentDate)}</td>
          <td className="px-3 py-1.5 text-gray-600 text-xs">{methodWithRef(p, methodName)}</td>
          <td className="px-3 py-1.5 text-gray-500 text-xs">{p.fxNote ?? ""}</td>
          <td className="px-3 py-1.5"></td>
        </tr>
      ))}
    </>
  );
}

function methodWithRef(p: PaymentSubline, methodName: (m: string) => string) {
  const label = methodName(p.method);
  return p.reference ? `${label} ${p.reference}` : label;
}

function TotalsRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={muted ? "text-gray-500" : "text-gray-700"}>{label}</span>
      <span className={muted ? "text-gray-500" : "text-gray-900"}>{value}</span>
    </div>
  );
}
