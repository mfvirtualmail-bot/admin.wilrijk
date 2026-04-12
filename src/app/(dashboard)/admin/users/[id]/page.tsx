"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth-context";
import { ALL_MODULES, MODULE_ACTIONS, type PermissionModule, type User } from "@/lib/types";

interface PermissionSet {
  [module: string]: { [action: string]: boolean };
}

function buildPermissionSet(permissions: { module: string; action: string }[]): PermissionSet {
  const set: PermissionSet = {};
  for (const mod of ALL_MODULES) {
    set[mod] = {};
    for (const action of MODULE_ACTIONS[mod as PermissionModule]) {
      set[mod][action] = false;
    }
  }
  for (const p of permissions) {
    if (set[p.module]) set[p.module][p.action] = true;
  }
  return set;
}

function flattenPermissions(set: PermissionSet) {
  const result: { module: string; action: string }[] = [];
  for (const mod of Object.keys(set)) {
    for (const action of Object.keys(set[mod])) {
      if (set[mod][action]) result.push({ module: mod, action });
    }
  }
  return result;
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user: currentUser } = useAuth();

  const [targetUser, setTargetUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<PermissionSet>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPerms, setSavingPerms] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Form fields
  const [displayName, setDisplayName] = useState("");
  const [language, setLanguage] = useState("en");
  const [isActive, setIsActive] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    fetch(`/api/users/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setTargetUser(d.user);
        setDisplayName(d.user.display_name);
        setLanguage(d.user.language);
        setIsActive(d.user.is_active);
        setIsSuperAdmin(d.user.is_super_admin);
        setPermissions(buildPermissionSet(d.permissions));
      })
      .catch(() => setError("Failed to load user"))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSaveDetails(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccessMsg("");

    const body: Record<string, unknown> = { display_name: displayName, language, is_active: isActive };
    if (currentUser?.is_super_admin) body.is_super_admin = isSuperAdmin;
    if (newPassword.trim()) body.password = newPassword.trim();

    const res = await fetch(`/api/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to save");
    } else {
      setSuccessMsg("User details saved.");
      setNewPassword("");
    }
    setSaving(false);
  }

  async function handleSavePermissions() {
    setSavingPerms(true);
    setError("");
    setSuccessMsg("");

    const res = await fetch(`/api/users/${id}/permissions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissions: flattenPermissions(permissions) }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to save permissions");
    } else {
      setSuccessMsg(`Permissions saved (${data.count} granted).`);
    }
    setSavingPerms(false);
  }

  function togglePermission(mod: string, action: string) {
    setPermissions((prev) => ({
      ...prev,
      [mod]: { ...prev[mod], [action]: !prev[mod][action] },
    }));
  }

  function toggleAllInModule(mod: string, checked: boolean) {
    setPermissions((prev) => {
      const updated = { ...prev[mod] };
      for (const action of Object.keys(updated)) updated[action] = checked;
      return { ...prev, [mod]: updated };
    });
  }

  const MODULE_LABELS: Record<string, string> = {
    families: "Families",
    children: "Children",
    charges: "Charges",
    payments: "Payments",
    spreadsheet: "Spreadsheet",
    reports: "Reports",
    users: "Users",
    settings: "Settings",
  };

  const ACTION_LABELS: Record<string, string> = {
    view: "View",
    add: "Add",
    edit: "Edit",
    delete: "Delete",
  };

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>;

  return (
    <div>
      <Header titleKey="page.users" />
      <div className="p-6 max-w-3xl">
        {/* Back link */}
        <Link href="/admin/users" className="text-sm text-blue-600 hover:underline mb-4 block">
          ← Back to users
        </Link>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-700 rounded-md p-3 text-sm">
            {successMsg}
          </div>
        )}

        {/* User Details */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">User Details</h2>
          <form onSubmit={handleSaveDetails} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input
                type="text"
                value={targetUser?.username ?? ""}
                disabled
                className="w-full px-3 py-2 border border-gray-200 rounded-md bg-gray-50 text-gray-500 text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">Username cannot be changed.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  <option value="en">English</option>
                  <option value="nl">Nederlands</option>
                  <option value="yi">ייִדיש</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={isActive ? "active" : "inactive"}
                  onChange={(e) => setIsActive(e.target.value === "active")}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            {currentUser?.is_super_admin && targetUser?.id !== currentUser.id && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="superAdmin"
                  checked={isSuperAdmin}
                  onChange={(e) => setIsSuperAdmin(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <label htmlFor="superAdmin" className="text-sm font-medium text-gray-700">
                  Super Admin (full access to all features)
                </label>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                New Password <span className="text-gray-400 font-normal">(leave blank to keep current)</span>
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password…"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Details"}
              </button>
            </div>
          </form>
        </div>

        {/* Permission Matrix — only super admins can edit, and not on themselves */}
        {currentUser?.is_super_admin && !isSuperAdmin && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Permissions</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  Grant module-level access for this user.
                </p>
              </div>
              <button
                onClick={handleSavePermissions}
                disabled={savingPerms}
                className="px-5 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium text-sm disabled:opacity-50"
              >
                {savingPerms ? "Saving…" : "Save Permissions"}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 pr-4 font-semibold text-gray-600 w-40">Module</th>
                    {["view", "add", "edit", "delete"].map((action) => (
                      <th key={action} className="text-center py-2 px-3 font-semibold text-gray-600 w-20">
                        {ACTION_LABELS[action]}
                      </th>
                    ))}
                    <th className="text-center py-2 px-3 font-semibold text-gray-500 w-20 text-xs">
                      All
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ALL_MODULES.map((mod) => {
                    const availableActions = MODULE_ACTIONS[mod as PermissionModule];
                    const allChecked = availableActions.every((a) => permissions[mod]?.[a]);
                    return (
                      <tr key={mod} className="hover:bg-gray-50">
                        <td className="py-3 pr-4 font-medium text-gray-700">
                          {MODULE_LABELS[mod]}
                        </td>
                        {["view", "add", "edit", "delete"].map((action) => {
                          const available = availableActions.includes(action as never);
                          return (
                            <td key={action} className="text-center py-3 px-3">
                              {available ? (
                                <input
                                  type="checkbox"
                                  checked={permissions[mod]?.[action] ?? false}
                                  onChange={() => togglePermission(mod, action)}
                                  className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                                />
                              ) : (
                                <span className="text-gray-200">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="text-center py-3 px-3">
                          <input
                            type="checkbox"
                            checked={allChecked}
                            onChange={(e) => toggleAllInModule(mod, e.target.checked)}
                            className="w-4 h-4 text-green-600 rounded cursor-pointer"
                            title="Toggle all"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {isSuperAdmin && currentUser?.is_super_admin && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-sm text-purple-700">
            This user is a <strong>Super Admin</strong> and has full access to everything.
            Permissions matrix is not applicable.
          </div>
        )}
      </div>
    </div>
  );
}
