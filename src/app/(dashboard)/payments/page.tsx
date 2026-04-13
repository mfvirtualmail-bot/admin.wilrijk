"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth-context";
import { METHOD_LABELS, METHOD_COLORS, MONTHS, formatDate, formatEur } from "@/lib/payment-utils";
import type { Payment, PaymentMethod } from "@/lib/types";

type PaymentWithFamily = Payment & { families: { name: string } | null };

export default function PaymentsPage() {
  const { user } = useAuth();
  const [payments, setPayments] = useState<PaymentWithFamily[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [filterMethod, setFilterMethod] = useState<string>("all");

  useEffect(() => {
    fetch("/api/payments")
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setPayments(d.payments); })
      .catch(() => setError("Failed to load payments"))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string) {
    if (!confirm("Delete this payment? This cannot be undone.")) return;
    setDeleting(id);
    const res = await fetch(`/api/payments/${id}`, { method: "DELETE" });
    if (res.ok) setPayments((p) => p.filter((x) => x.id !== id));
    else { const d = await res.json(); alert(d.error || "Failed to delete"); }
    setDeleting(null);
  }

  const filtered = payments.filter((p) => filterMethod === "all" || p.payment_method === filterMethod);
  const total = filtered.reduce((s, p) => s + Number(p.amount), 0);
  const canAdd = user?.is_super_admin;
  const canDelete = user?.is_super_admin;

  return (
    <div>
      <Header titleKey="page.payments" />
      <div className="p-6">
        <div className="flex flex-wrap gap-3 items-center mb-6">
          <select value={filterMethod} onChange={(e) => setFilterMethod(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">All methods</option>
            {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>{METHOD_LABELS[m]}</option>
            ))}
          </select>
          <span className="text-sm text-gray-500">{filtered.length} payments</span>
          <span className="text-sm font-semibold text-gray-700">Total: {formatEur(total)}</span>
          {canAdd && (
            <>
              <Link
                href="/payments/import"
                className="ml-auto px-4 py-2 border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50 font-medium text-sm"
              >
                Import from Excel
              </Link>
              <Link href="/payments/new" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm">
                + New Payment
              </Link>
            </>
          )}
        </div>

        {loading && <div className="text-center py-12 text-gray-500">Loading…</div>}
        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-4">{error}</div>}

        {!loading && !error && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Family</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Method</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Period</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Notes</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Amount</th>
                  {canDelete && <th className="text-right px-4 py-3 font-semibold text-gray-600">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatDate(p.payment_date)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <Link href={`/families/${p.family_id}`} className="hover:text-blue-600">{p.families?.name ?? "—"}</Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${METHOD_COLORS[p.payment_method]}`}>
                        {METHOD_LABELS[p.payment_method]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {p.month && p.year ? `${MONTHS[p.month]} ${p.year}` : <span className="text-gray-400 italic">Unallocated</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">{p.notes ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatEur(Number(p.amount))}</td>
                    {canDelete && (
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => handleDelete(p.id)} disabled={deleting === p.id}
                          className="text-red-500 hover:text-red-700 font-medium disabled:opacity-40">
                          {deleting === p.id ? "…" : "Delete"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={canDelete ? 7 : 6} className="px-4 py-8 text-center text-gray-400">No payments found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
