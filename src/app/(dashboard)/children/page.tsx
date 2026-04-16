"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency, formatEur } from "@/lib/payment-utils";
import { familyDisplayName } from "@/lib/family-utils";
import ConversionBreakdown, { type BreakdownRow } from "@/components/ConversionBreakdown";
import type { Currency } from "@/lib/types";

interface ChildRow {
  id: string;
  first_name: string;
  last_name: string;
  family_id: string;
  class_name: string | null;
  monthly_tuition: number;
  currency: Currency | null;
  is_active: boolean;
  families: { name: string; father_name: string | null } | null;
}

interface ChildrenSummary {
  totalMonthlyEur: number;
  missing: number;
  breakdown: BreakdownRow[];
}

export default function ChildrenPage() {
  const { user } = useAuth();
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [summary, setSummary] = useState<ChildrenSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  // Delete state
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  useEffect(() => {
    fetch("/api/children")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setChildren(d.children);
        if (d.summary) setSummary(d.summary);
      })
      .catch(() => setError("Failed to load children"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = children.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.first_name.toLowerCase().includes(q) ||
      c.last_name.toLowerCase().includes(q) ||
      (c.families?.name ?? "").toLowerCase().includes(q) ||
      (c.class_name ?? "").toLowerCase().includes(q)
    );
  });

  // Page-wide monthly total is converted to EUR server-side (summary).
  // Filtered total is shown when a search is active, also in EUR when
  // we have breakdown data; otherwise falls back to naive sum.
  const totalMonthlyEur = summary?.totalMonthlyEur ?? 0;
  const canDelete = user?.is_super_admin;

  // Selection helpers
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const selectedCount = selectedIds.length;
  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selected[c.id]);
  const someFilteredSelected = filtered.some((c) => selected[c.id]);

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
      filtered.forEach((c) => { next[c.id] = true; });
      setSelected(next);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  // Single delete
  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`Delete student "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    const res = await fetch(`/api/children/${id}`, { method: "DELETE" });
    if (res.ok) {
      setChildren((prev) => prev.filter((c) => c.id !== id));
      setSelected((prev) => { const next = { ...prev }; delete next[id]; return next; });
    } else {
      const d = await res.json();
      alert(d.error || "Failed to delete");
    }
    setDeleting(null);
  }, []);

  // Bulk delete
  async function handleBulkDelete() {
    if (!confirm(`Delete ${selectedCount} ${selectedCount === 1 ? "student" : "students"}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    const ids = [...selectedIds];
    let deleted = 0;
    for (const id of ids) {
      const res = await fetch(`/api/children/${id}`, { method: "DELETE" });
      if (res.ok) {
        deleted++;
        setChildren((prev) => prev.filter((c) => c.id !== id));
      }
    }
    setSelected({});
    setBulkDeleting(false);
    if (deleted < ids.length) {
      alert(`Deleted ${deleted} of ${ids.length} students. Some could not be deleted.`);
    }
  }

  const colCount = canDelete ? 7 : 5;

  return (
    <div>
      <Header titleKey="page.children" />
      <div className="p-6">
        <div className="flex flex-wrap gap-3 items-center mb-6">
          <input type="text" placeholder="Search by name, family or class…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 max-w-xs px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span className="text-sm text-gray-500">{filtered.length} students</span>
          <span className="text-sm font-semibold text-gray-700" title="Sum of every active student's monthly tuition, converted to EUR at today's rate.">
            Monthly total: {formatEur(totalMonthlyEur)}
          </span>
          {canDelete && selectedCount > 0 && (
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-medium text-sm disabled:opacity-50"
            >
              {bulkDeleting ? "Deleting…" : `Delete ${selectedCount} selected`}
            </button>
          )}
          <Link href="/families/new" className="ml-auto px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm">
            + New Family
          </Link>
        </div>

        {loading && <div className="text-center py-12 text-gray-500">Loading…</div>}
        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-4">{error}</div>}

        {!loading && !error && summary && (
          <ConversionBreakdown
            label="Monthly tuition"
            rows={summary.breakdown}
            missing={summary.missing}
          />
        )}

        {!loading && !error && (
          <div className="mt-4 bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
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
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Student</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Family</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Class</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Monthly Tuition</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                  {canDelete && (
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((c) => (
                  <tr key={c.id} className={`hover:bg-gray-50 ${selected[c.id] ? "bg-blue-50" : ""}`}>
                    {canDelete && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={!!selected[c.id]}
                          onChange={() => toggleSelect(c.id)}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 font-medium text-gray-900">{c.first_name} {c.last_name}</td>
                    <td className="px-4 py-3">
                      <Link href={`/families/${c.family_id}`} className="text-blue-600 hover:underline">
                        {c.families ? familyDisplayName(c.families.name, c.families.father_name) : "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.class_name ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatCurrency(Number(c.monthly_tuition), (c.currency as Currency) ?? "EUR")}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${c.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {c.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    {canDelete && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDelete(c.id, `${c.first_name} ${c.last_name}`)}
                          disabled={deleting === c.id || bulkDeleting}
                          className="text-red-500 hover:text-red-700 font-medium text-sm disabled:opacity-40"
                        >
                          {deleting === c.id ? "…" : "Delete"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={colCount} className="px-4 py-8 text-center text-gray-400">
                    {search ? "No students match your search." : "No students yet. Add families with students to get started."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
