"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth-context";
import { exportSheet, dateStampedFilename } from "@/lib/export-utils";
import type { User } from "@/lib/types";

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setUsers(d.users);
      })
      .catch(() => setError("Failed to load users"))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
    if (res.ok) {
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } else {
      const d = await res.json();
      alert(d.error || "Failed to delete user");
    }
    setDeleting(null);
  }

  const LANG_LABELS: Record<string, string> = { en: "EN", nl: "NL", yi: "יי" };

  async function handleExport() {
    const headers = ["Display Name", "Username", "Language", "Role", "Status"];
    const rows = users.map((u) => [
      u.display_name,
      u.username,
      LANG_LABELS[u.language] ?? u.language,
      u.is_super_admin ? "Super Admin" : "User",
      u.is_active ? "Active" : "Inactive",
    ]);
    await exportSheet(dateStampedFilename("users"), "Users", headers, rows);
  }

  return (
    <div>
      <Header titleKey="page.users" />
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <p className="text-gray-600">
            {users.length} user{users.length !== 1 ? "s" : ""}
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleExport}
              disabled={users.length === 0}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium text-sm disabled:opacity-40"
            >
              Export Excel
            </button>
            {currentUser?.is_super_admin && (
              <Link
                href="/admin/users/new"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm"
              >
                + New User
              </Link>
            )}
          </div>
        </div>

        {loading && (
          <div className="text-center py-12 text-gray-500">Loading users…</div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-4">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Username</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Lang</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Role</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {u.display_name}
                      {u.id === currentUser?.id && (
                        <span className="ml-2 text-xs text-gray-400">(you)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">{u.username}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 bg-gray-100 rounded text-xs font-medium">
                        {LANG_LABELS[u.language] ?? u.language}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.is_super_admin ? (
                        <span className="inline-block px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-semibold">
                          Super Admin
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">
                          User
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          u.is_active
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {u.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                      >
                        Edit
                      </Link>
                      {currentUser?.is_super_admin && u.id !== currentUser.id && (
                        <button
                          onClick={() => handleDelete(u.id, u.display_name)}
                          disabled={deleting === u.id}
                          className="text-red-500 hover:text-red-700 text-sm font-medium disabled:opacity-40"
                        >
                          {deleting === u.id ? "…" : "Delete"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      No users found.
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
