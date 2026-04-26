"use client";

import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import AcademicYearSelector from "@/components/AcademicYearSelector";
import { formatEur } from "@/lib/payment-utils";
import { usePaymentMethods } from "@/lib/use-settings";
import ConversionBreakdown, { type BreakdownRow } from "@/components/ConversionBreakdown";

interface MonthlyStat {
  month: number;
  year: number;
  hebrewLabel: string;
  collected: number;
  expected: number;
  paidCount: number;
  totalFamilies: number;
}

interface MethodEntry { count: number; amount: number }

interface OutstandingFamily {
  id: string;
  name: string;
  charged: number;
  paid: number;
  due: number;
}

interface RangeBlock {
  start: string;
  end: string;
  totalPaid: number;
  paidCount: number;
  methodBreakdown: Record<string, MethodEntry>;
}

interface ReportsData {
  hebrewYear: number;
  academicYear: number;
  summary: { totalCharged: number; totalPaid: number; totalDue: number; familyCount: number };
  monthlyStats: MonthlyStat[];
  methodBreakdown: Record<string, MethodEntry>;
  outstandingFamilies: OutstandingFamily[];
  breakdown?: {
    payments: BreakdownRow[];
    charges: BreakdownRow[];
    paymentsMissing: number;
    chargesMissing: number;
  };
  range: RangeBlock | null;
}

/**
 * Pick a stable ~same-hue class for each payment-method code.
 * Falls back to a neutral gray for anything custom the operator added
 * after the built-ins (crc/kas/bank/other).
 */
function methodBarClass(code: string): string {
  const map: Record<string, string> = {
    crc: "bg-blue-500",
    kas: "bg-green-500",
    bank: "bg-purple-500",
    other: "bg-gray-400",
  };
  if (map[code]) return map[code];
  const palette = ["bg-pink-500", "bg-teal-500", "bg-orange-500", "bg-indigo-500", "bg-rose-500", "bg-cyan-500"];
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}

export default function ReportsPage() {
  const { methodLabels } = usePaymentMethods();
  const [hebrewYear, setHebrewYear] = useState<number | null>(null);
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Free date-range controls (independent of the academic-year filter).
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");
  const [rangeSubmitted, setRangeSubmitted] = useState<{ start: string; end: string } | null>(null);

  useEffect(() => {
    if (hebrewYear == null) return;
    setLoading(true);
    const params = new URLSearchParams({ year: String(hebrewYear) });
    if (rangeSubmitted) {
      params.set("start", rangeSubmitted.start);
      params.set("end", rangeSubmitted.end);
    }
    fetch(`/api/reports?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setData(d);
        setError("");
      })
      .catch(() => setError("Failed to load reports"))
      .finally(() => setLoading(false));
  }, [hebrewYear, rangeSubmitted]);

  function applyRange(e: React.FormEvent) {
    e.preventDefault();
    if (!rangeStart || !rangeEnd) return;
    if (rangeStart > rangeEnd) return;
    setRangeSubmitted({ start: rangeStart, end: rangeEnd });
  }
  function clearRange() {
    setRangeStart("");
    setRangeEnd("");
    setRangeSubmitted(null);
  }

  const collectionRate = data && data.summary.totalCharged > 0
    ? Math.round((data.summary.totalPaid / data.summary.totalCharged) * 100)
    : 0;

  const maxCollected = useMemo(() => {
    if (!data) return 1;
    return Math.max(...data.monthlyStats.map((m) => m.expected), 1);
  }, [data]);

  const labelFor = (code: string) => methodLabels[code] ?? code;

  return (
    <div>
      <Header titleKey="page.reports" />
      <div className="p-6 space-y-6 max-w-5xl">

        {/* Year selector */}
        <div className="flex flex-wrap gap-3 items-center pb-3 border-b border-gray-200">
          <AcademicYearSelector value={hebrewYear} onChange={setHebrewYear} compact />
        </div>

        {loading && <div className="p-6 text-gray-500 text-center">Loading reports…</div>}
        {error && <div className="p-6 text-red-600">{error}</div>}

        {!loading && !error && data && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total Charged", value: formatEur(data.summary.totalCharged), color: "text-gray-900" },
                { label: "Total Collected", value: formatEur(data.summary.totalPaid), color: "text-green-700" },
                { label: "Outstanding", value: formatEur(data.summary.totalDue), color: data.summary.totalDue > 0 ? "text-red-600" : "text-green-600" },
                { label: "Collection Rate", value: `${collectionRate}%`, color: collectionRate >= 80 ? "text-green-700" : collectionRate >= 50 ? "text-yellow-600" : "text-red-600" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                  <p className="text-xs text-gray-500 mb-1">{label}</p>
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-semibold text-gray-800">Collection Progress</h3>
                <span className="text-sm text-gray-500">{collectionRate}% of annual target</span>
              </div>
              <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, collectionRate)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>{formatEur(data.summary.totalPaid)} paid</span>
                <span>{formatEur(data.summary.totalCharged)} charged</span>
              </div>
              {data.breakdown && (
                <>
                  <ConversionBreakdown
                    label="Payments"
                    rows={data.breakdown.payments}
                    missing={data.breakdown.paymentsMissing}
                  />
                  <ConversionBreakdown
                    label="Charges"
                    rows={data.breakdown.charges}
                    missing={data.breakdown.chargesMissing}
                  />
                </>
              )}
            </div>

            {/* Monthly collection chart */}
            <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
              <h3 className="font-semibold text-gray-800 mb-4">Monthly Collection</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-right pb-2 font-semibold text-gray-600 pr-3">Month</th>
                      <th className="text-right pb-2 font-semibold text-gray-600">Expected</th>
                      <th className="text-right pb-2 font-semibold text-gray-600">Collected</th>
                      <th className="text-right pb-2 font-semibold text-gray-600">Gap</th>
                      <th className="pb-2 pl-4 w-40">Progress</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.monthlyStats.map((m) => {
                      const pct = m.expected > 0 ? Math.min(100, Math.round((m.collected / m.expected) * 100)) : 0;
                      const gap = m.expected - m.collected;
                      return (
                        <tr key={`${m.month}-${m.year}`} className="hover:bg-gray-50">
                          <td className="py-2 pr-3 text-right font-medium text-gray-700" dir="rtl">{m.hebrewLabel}</td>
                          <td className="py-2 text-right text-gray-600">{formatEur(m.expected)}</td>
                          <td className="py-2 text-right font-semibold text-green-700">{m.collected > 0 ? formatEur(m.collected) : <span className="text-gray-300">—</span>}</td>
                          <td className={`py-2 text-right text-xs font-medium ${gap > 0 ? "text-red-500" : "text-green-600"}`}>
                            {gap > 0 ? `-${formatEur(gap)}` : "✓"}
                          </td>
                          <td className="py-2 pl-4">
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden w-32">
                              <div
                                className={`h-full rounded-full ${pct >= 100 ? "bg-green-500" : pct >= 50 ? "bg-yellow-400" : "bg-red-400"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-400 ml-1">{pct}%</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Payment method breakdown */}
              <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
                <h3 className="font-semibold text-gray-800 mb-4">Payment Methods</h3>
                {Object.keys(data.methodBreakdown).length === 0 ? (
                  <p className="text-gray-400 text-sm">No payments recorded for this year.</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(data.methodBreakdown)
                      .sort((a, b) => b[1].amount - a[1].amount)
                      .map(([method, { count, amount }]) => {
                        const pct = data.summary.totalPaid > 0 ? Math.round((amount / data.summary.totalPaid) * 100) : 0;
                        return (
                          <div key={method}>
                            <div className="flex justify-between text-sm mb-1">
                              <span className="font-medium text-gray-700">{labelFor(method)}</span>
                              <span className="text-gray-500">{count} payments · {formatEur(amount)}</span>
                            </div>
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${methodBarClass(method)}`} style={{ width: `${pct}%` }} />
                            </div>
                            <div className="text-xs text-gray-400 text-right">{pct}%</div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Outstanding families */}
              <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
                <h3 className="font-semibold text-gray-800 mb-4">
                  Outstanding Balances
                  {data.outstandingFamilies.length > 0 && (
                    <span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">
                      {data.outstandingFamilies.length}
                    </span>
                  )}
                </h3>
                {data.outstandingFamilies.length === 0 ? (
                  <p className="text-green-600 text-sm font-medium">All families are up to date for this year!</p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {data.outstandingFamilies.map((f) => (
                      <div key={f.id} className="flex justify-between items-center py-1.5 border-b border-gray-50 last:border-0">
                        <a href={`/families/${f.id}`} className="text-sm font-medium text-blue-600 hover:underline">
                          {f.name}
                        </a>
                        <span className="text-sm font-bold text-red-600">{formatEur(f.due)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Bar chart */}
            <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
              <h3 className="font-semibold text-gray-800 mb-4">Monthly Overview (Bar Chart)</h3>
              <div className="flex items-end gap-1 h-40 overflow-x-auto pb-2">
                {data.monthlyStats.map((m) => {
                  const collectedPct = m.expected > 0 ? Math.min(100, (m.collected / maxCollected) * 100) : 0;
                  const expectedBarPct = (m.expected / maxCollected) * 100;
                  return (
                    <div key={`${m.month}-${m.year}`} className="flex flex-col items-center gap-0.5 flex-1 min-w-[40px]">
                      <div className="relative w-full flex justify-center items-end" style={{ height: "100px" }}>
                        <div
                          className="absolute bottom-0 w-full bg-gray-100 rounded-t"
                          style={{ height: `${expectedBarPct}%` }}
                        />
                        <div
                          className={`absolute bottom-0 w-3/4 rounded-t transition-all ${
                            collectedPct >= 95 ? "bg-green-500" : collectedPct >= 50 ? "bg-yellow-400" : "bg-red-400"
                          }`}
                          style={{ height: `${collectedPct}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 text-center" dir="rtl" style={{ fontSize: "9px", lineHeight: "1.2" }}>
                        {m.hebrewLabel.split(" ")[0]}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-4 text-xs text-gray-500 mt-1">
                <span className="flex items-center gap-1"><span className="w-3 h-2 bg-gray-200 rounded inline-block" /> Expected</span>
                <span className="flex items-center gap-1"><span className="w-3 h-2 bg-green-500 rounded inline-block" /> Collected</span>
              </div>
            </div>

            {/* Free date-range collection */}
            <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
              <h3 className="font-semibold text-gray-800 mb-3">Collection in Date Range</h3>
              <p className="text-xs text-gray-500 mb-3">
                Show how much was collected across any date range — independent of the academic year above.
                Uses payment_date; does not depend on which charge the payment belonged to.
              </p>
              <form onSubmit={applyRange} className="flex flex-wrap gap-3 items-end mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Start</label>
                  <input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm" required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">End</label>
                  <input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm" required />
                </div>
                <button type="submit" className="px-4 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium">
                  Apply
                </button>
                {rangeSubmitted && (
                  <button type="button" onClick={clearRange} className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 text-sm">
                    Clear
                  </button>
                )}
              </form>

              {!data.range && (
                <p className="text-sm text-gray-400">Pick a start and end date to see totals.</p>
              )}

              {data.range && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 rounded-md bg-green-50 border border-green-200">
                      <p className="text-xs text-green-800 uppercase tracking-wide">Total collected</p>
                      <p className="text-xl font-bold text-green-700">{formatEur(data.range.totalPaid)}</p>
                    </div>
                    <div className="p-3 rounded-md bg-blue-50 border border-blue-200">
                      <p className="text-xs text-blue-800 uppercase tracking-wide">Payments</p>
                      <p className="text-xl font-bold text-blue-700">{data.range.paidCount}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{data.range.start} → {data.range.end}</p>
                    </div>
                  </div>

                  {Object.keys(data.range.methodBreakdown).length > 0 && (
                    <div>
                      <h4 className="font-semibold text-sm text-gray-700 mb-2">By method</h4>
                      <div className="space-y-2">
                        {Object.entries(data.range.methodBreakdown)
                          .sort((a, b) => b[1].amount - a[1].amount)
                          .map(([m, { count, amount }]) => {
                            const pct = data.range!.totalPaid > 0 ? Math.round((amount / data.range!.totalPaid) * 100) : 0;
                            return (
                              <div key={m}>
                                <div className="flex justify-between text-sm mb-1">
                                  <span className="font-medium text-gray-700">{labelFor(m)}</span>
                                  <span className="text-gray-500">{count} · {formatEur(amount)} · {pct}%</span>
                                </div>
                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${methodBarClass(m)}`} style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
