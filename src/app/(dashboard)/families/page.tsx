"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth-context";
import type { Family } from "@/lib/types";

export default function FamiliesPage() {
  const { user } = useAuth();
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  // Delete state
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  useEffect(() => {
    fetch("/api/families")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setFamilies(d.families);
      })
      .catch(() => setError("Failed to load families"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = families.filter((f) => {
    const q = search.toLowerCase();
    return (
      f.name.toLowerCase().includes(q) ||
      (f.father_name ?? "").toLowerCase().includes(q) ||
      (f.city ?? "").toLowerCase().includes(q) ||
      (f.phone ?? "").includes(q) ||
      (f.email ?? "").toLowerCase().includes(q)
    );
  });

  const canDelete = user?.is_super_admin;

  // Selection helpers
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const selectedCount = selectedIds.length;
  const allFilteredSelected = filtered.length > 0 && filtered.every((f) => selected[f.id]);
  const someFilteredSelected = filtered.some((f) => selected[f.id]);

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
      filtered.forEach((f) => { next[f.id] = true; });
      setSelected(next);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  // Single delete
  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`Delete family "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    const res = await fetch(`/api/families/${id}`, { method: "DELETE" });
    if (res.ok) {
      setFamilies((prev) => prev.filter((f) => f.id !== id));
      setSelected((prev) => { const next = { ...prev }; delete next[id]; return next; });
    } else {
      const d = await res.json();
      alert(d.error || "Failed to delete");
    }
    setDeleting(null);
  }, []);

  // Bulk delete
  async function handleBulkDelete() {
    if (!confirm(`Delete ${selectedCount} ${selectedCount === 1 ? "family" : "families"}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    const ids = [...selectedIds];
    let deleted = 0;
    for (const id of ids) {
      const res = await fetch(`/api/families/${id}`, { method: "DELETE" });
      if (res.ok) {
        deleted++;
        setFamilies((prev) => prev.filter((f) => f.id !== id));
      }
    }
    setSelected({});
    setBulkDeleting(false);
    if (deleted < ids.length) {
      alert(`Deleted ${deleted} of ${ids.length} families. Some could not be deleted.`);
    }
  }

  const colCount = canDelete ? 8 : 6;

  return (
    <div>
      <Header titleKey="page.families" />
      <div className="p-6">
        {/* Toolbar */}
        <div className="flex flex-wrap gap-3 items-center mb-6">
          <input
            type="text"
            placeholder="Search by name, city, phone or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 max-w-sm px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-500">{filtered.length} families</span>
          {canDelete && selectedCount > 0 && (
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-medium text-sm disabled:opacity-50"
            >
              {bulkDeleting ? "Deleting…" : `Delete ${selectedCount} selected`}
            </button>
          )}
          {canDelete && (
            <>
              <Link
                href="/families/import"
                className="px-4 py-2 border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50 font-medium text-sm"
              >
                Import from Excel
              </Link>
              <Link
                href="/families/new"
                className="ml-auto px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm"
              >
                + Add Family
              </Link>
            </>
          )}
        </div>

        {loading && <div className="text-center py-12 text-gray-500">Loading…</div>}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-4">{error}</div>
        )}

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
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Family Name</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Father</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">City</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Phone</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                  {canDelete && (
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((f) => (
                  <tr key={f.id} className={`hover:bg-gray-50 ${selected[f.id] ? "bg-blue-50" : ""}`}>
                    {canDelete && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={!!selected[f.id]}
                          onChange={() => toggleSelect(f.id)}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <Link
                        href={`/families/${f.id}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {f.father_name ? `${f.name} (${f.father_name})` : f.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{f.father_name ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{f.city ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{f.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{f.email ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          f.is_active
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {f.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    {canDelete && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDelete(f.id, f.name)}
                          disabled={deleting === f.id || bulkDeleting}
                          className="text-red-500 hover:text-red-700 font-medium text-sm disabled:opacity-40"
                        >
                          {deleting === f.id ? "…" : "Delete"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-10 text-center text-gray-400">
                      {search
                        ? "No families match your search."
                        : "No families yet. Click \"+ Add Family\" or import from Excel to get started."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
