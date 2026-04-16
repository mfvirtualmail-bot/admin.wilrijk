"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth-context";
import { METHOD_COLORS, MONTHS, formatDate, formatCurrency } from "@/lib/payment-utils";
import { usePaymentMethods } from "@/lib/use-settings";
import { familyDisplayName } from "@/lib/family-utils";
import { exportToExcel, exportTimestamp, formatDateForExport } from "@/lib/export-utils";
import type { Payment, Currency } from "@/lib/types";

type PaymentWithFamily = Payment & { families: { name: string; father_name: string | null } | null };

export default function PaymentsPage() {
  const { user } = useAuth();
  const { methodLabels } = usePaymentMethods();
  const [payments, setPayments] = useState<PaymentWithFamily[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [filterMethod, setFilterMethod] = useState<string>("all");

  // Bulk delete state
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkDeleting, setBulkDeleting] = useState(false);

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
    if (res.ok) {
      setPayments((p) => p.filter((x) => x.id !== id));
      setSelected((prev) => { const next = { ...prev }; delete next[id]; return next; });
    } else {
      const d = await res.json();
      alert(d.error || "Failed to delete");
    }
    setDeleting(null);
  }

  const filtered = payments.filter((p) => filterMethod === "all" || p.payment_method === filterMethod);
  const total = filtered.reduce((s, p) => s + Number(p.amount), 0);
  const canAdd = user?.is_super_admin;
  const canDelete = user?.is_super_admin;

  async function handleExport() {
    const headers = ["Date", "Family", "Father", "Method", "Period", "Currency", "Amount", "Notes"];
    const rows: unknown[][] = [headers];
    for (const p of filtered) {
      rows.push([
        formatDateForExport(p.payment_date),
        p.families?.name ?? "",
        p.families?.father_name ?? "",
        methodLabels[p.payment_method] ?? p.payment_method,
        p.month && p.year ? `${MONTHS[p.month]} ${p.year}` : "",
        (p.currency as Currency) ?? "EUR",
        Number(p.amount),
        p.notes ?? "",
      ]);
    }
    await exportToExcel(`payments-${exportTimestamp()}`, [{ name: "Payments", rows }]);
  }

  // Selection helpers
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const selectedCount = selectedIds.length;
  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selected[p.id]);
  const someFilteredSelected = filtered.some((p) => selected[p.id]);

  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someFilteredSelected && !allFilteredSelected;
    }
  }, [someFilteredSelected, allFilteredSelected]);

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelected({});
    } else {
      const next: Record<string, boolean> = {};
      filtered.forEach((p) => { next[p.id] = true; });
      setSelected(next);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  // Bulk delete
  async function handleBulkDelete() {
    if (!confirm(`Delete ${selectedCount} ${selectedCount === 1 ? "payment" : "payments"}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    const ids = [...selectedIds];
    let deleted = 0;
    for (const id of ids) {
      const res = await fetch(`/api/payments/${id}`, { method: "DELETE" });
      if (res.ok) {
        deleted++;
        setPayments((prev) => prev.filter((p) => p.id !== id));
      }
    }
    setSelected({});
    setBulkDeleting(false);
    if (deleted < ids.length) {
      alert(`Deleted ${deleted} of ${ids.length} payments. Some could not be deleted.`);
    }
  }

  const colCount = canDelete ? 8 : 6;

  return (
    <div>
      <Header titleKey="page.payments" />
      <div className="p-6">
        <div className="flex flex-wrap gap-3 items-center mb-6">
          <select value={filterMethod} onChange={(e) => setFilterMethod(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">All methods</option>
            {Object.keys(methodLabels).map((m) => (
              <option key={m} value={m}>{methodLabels[m]}</option>
            ))}
          </select>
          <span className="text-sm text-gray-500">{filtered.length} payments</span>
          <span className="text-sm font-semibold text-gray-700">Total: {formatCurrency(total)}</span>
          {canDelete && selectedCount > 0 && (
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-medium text-sm disabled:opacity-50"
            >
              {bulkDeleting ? "Deleting…" : `Delete ${selectedCount} selected`}
            </button>
          )}
          <button
            type="button"
            onClick={handleExport}
            disabled={filtered.length === 0}
            className={`${canAdd ? "" : "ml-auto"} px-4 py-2 border border-green-600 text-green-700 rounded-md hover:bg-green-50 font-medium text-sm disabled:opacity-40`}
          >
            Export Excel
          </button>
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
                  {canDelete && (
                    <th className="px-4 py-3 w-10">
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 text-blue-600 rounded"
                      />
                    </th>
                  )}
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
                  <tr key={p.id} className={`hover:bg-gray-50 ${selected[p.id] ? "bg-blue-50" : ""}`}>
                    {canDelete && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={!!selected[p.id]}
                          onChange={() => toggleSelect(p.id)}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatDate(p.payment_date)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <Link href={`/families/${p.family_id}`} className="hover:text-blue-600">{p.families ? familyDisplayName(p.families.name, p.families.father_name) : "—"}</Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${METHOD_COLORS[p.payment_method] ?? "bg-gray-100 text-gray-700"}`}>
                        {methodLabels[p.payment_method] ?? p.payment_method}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {p.month && p.year ? `${MONTHS[p.month]} ${p.year}` : <span className="text-gray-400 italic">Unallocated</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">{p.notes ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatCurrency(Number(p.amount), (p.currency as Currency) ?? "EUR")}</td>
                    {canDelete && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-3 justify-end">
                          <Link href={`/payments/${p.id}/edit`}
                            className="text-blue-600 hover:text-blue-800 font-medium">
                            Edit
                          </Link>
                          <button onClick={() => handleDelete(p.id)} disabled={deleting === p.id || bulkDeleting}
                            className="text-red-500 hover:text-red-700 font-medium disabled:opacity-40">
                            {deleting === p.id ? "…" : "Delete"}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={colCount} className="px-4 py-8 text-center text-gray-400">No payments found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
