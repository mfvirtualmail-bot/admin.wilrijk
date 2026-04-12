"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { formatEur } from "@/lib/payment-utils";

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

interface ReportsData {
  academicYear: number;
  summary: { totalCharged: number; totalPaid: number; totalDue: number; familyCount: number };
  monthlyStats: MonthlyStat[];
  methodBreakdown: Record<string, MethodEntry>;
  outstandingFamilies: OutstandingFamily[];
}

const METHOD_NAMES: Record<string, string> = {
  crc: "Credit Card",
  kas: "Cash",
  bank: "Bank Transfer",
  other: "Other",
};

export default function ReportsPage() {
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/reports")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setData(d);
      })
      .catch(() => setError("Failed to load reports"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div>
      <Header titleKey="page.reports" />
      <div className="p-8 text-gray-500 text-center">Loading reports…</div>
    </div>
  );

  if (error) return (
    <div>
      <Header titleKey="page.reports" />
      <div className="p-8 text-red-600">{error}</div>
    </div>
  );

  if (!data) return null;

  const { summary, monthlyStats, methodBreakdown, outstandingFamilies } = data;
  const collectionRate = summary.totalCharged > 0
    ? Math.round((summary.totalPaid / summary.totalCharged) * 100)
    : 0;

  const maxCollected = Math.max(...monthlyStats.map((m) => m.expected), 1);

  return (
    <div>
      <Header titleKey="page.reports" />
      <div className="p-6 space-y-6 max-w-5xl">

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Charged", value: formatEur(summary.totalCharged), color: "text-gray-900" },
            { label: "Total Collected", value: formatEur(summary.totalPaid), color: "text-green-700" },
            { label: "Outstanding", value: formatEur(summary.totalDue), color: summary.totalDue > 0 ? "text-red-600" : "text-green-600" },
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
            <span>{formatEur(summary.totalPaid)} paid</span>
            <span>{formatEur(summary.totalCharged)} charged</span>
          </div>
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
                {monthlyStats.map((m) => {
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
            {Object.keys(methodBreakdown).length === 0 ? (
              <p className="text-gray-400 text-sm">No payments recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(methodBreakdown)
                  .sort((a, b) => b[1].amount - a[1].amount)
                  .map(([method, { count, amount }]) => {
                    const pct = summary.totalPaid > 0 ? Math.round((amount / summary.totalPaid) * 100) : 0;
                    const colors: Record<string, string> = {
                      crc: "bg-blue-500", kas: "bg-green-500", bank: "bg-purple-500", other: "bg-gray-400",
                    };
                    return (
                      <div key={method}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium text-gray-700">{METHOD_NAMES[method] ?? method}</span>
                          <span className="text-gray-500">{count} payments · {formatEur(amount)}</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${colors[method] ?? "bg-gray-400"}`} style={{ width: `${pct}%` }} />
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
              {outstandingFamilies.length > 0 && (
                <span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">
                  {outstandingFamilies.length}
                </span>
              )}
            </h3>
            {outstandingFamilies.length === 0 ? (
              <p className="text-green-600 text-sm font-medium">All families are up to date!</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {outstandingFamilies.map((f) => (
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

        {/* Bar chart: monthly collected vs expected */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <h3 className="font-semibold text-gray-800 mb-4">Monthly Overview (Bar Chart)</h3>
          <div className="flex items-end gap-1 h-40 overflow-x-auto pb-2">
            {monthlyStats.map((m) => {
              const collectedPct = m.expected > 0 ? Math.min(100, (m.collected / maxCollected) * 100) : 0;
              const expectedBarPct = (m.expected / maxCollected) * 100;
              return (
                <div key={`${m.month}-${m.year}`} className="flex flex-col items-center gap-0.5 flex-1 min-w-[40px]">
                  <div className="relative w-full flex justify-center items-end" style={{ height: "100px" }}>
                    {/* Expected bar (background) */}
                    <div
                      className="absolute bottom-0 w-full bg-gray-100 rounded-t"
                      style={{ height: `${expectedBarPct}%` }}
                    />
                    {/* Collected bar */}
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

      </div>
    </div>
  );
}
