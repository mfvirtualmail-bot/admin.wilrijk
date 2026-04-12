"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { formatEur } from "@/lib/payment-utils";

interface ChildRow {
  id: string;
  first_name: string;
  last_name: string;
  family_id: string;
  class_name: string | null;
  monthly_tuition: number;
  is_active: boolean;
  families: { name: string } | null;
}

export default function ChildrenPage() {
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/children")
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setChildren(d.children); })
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

  const totalMonthly = filtered.filter((c) => c.is_active).reduce((s, c) => s + Number(c.monthly_tuition), 0);

  return (
    <div>
      <Header titleKey="page.children" />
      <div className="p-6">
        <div className="flex flex-wrap gap-3 items-center mb-6">
          <input type="text" placeholder="Search by name, family or class…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 max-w-xs px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span className="text-sm text-gray-500">{filtered.length} students</span>
          <span className="text-sm font-semibold text-gray-700">Monthly total: {formatEur(totalMonthly)}</span>
          <Link href="/families/new" className="ml-auto px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm">
            + New Family
          </Link>
        </div>

        {loading && <div className="text-center py-12 text-gray-500">Loading…</div>}
        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-4">{error}</div>}

        {!loading && !error && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Student</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Family</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Class</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Monthly Tuition</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.first_name} {c.last_name}</td>
                    <td className="px-4 py-3">
                      <Link href={`/families/${c.family_id}`} className="text-blue-600 hover:underline">
                        {c.families?.name ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.class_name ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatEur(Number(c.monthly_tuition))}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${c.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {c.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    {search ? "No students match your search." : "No students yet. Add families with children to get started."}
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
