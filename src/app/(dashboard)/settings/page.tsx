"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth-context";

interface AuditEntry {
  id: string;
  action: string;
  table_name: string;
  record_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
  users: { username: string; display_name: string | null } | null;
}

const METHOD_KEYS = ["crc", "kas", "bank", "other"];
const DEFAULT_METHOD_LABELS: Record<string, string> = {
  crc: "Credit Card",
  kas: "Cash",
  bank: "Bank Transfer",
  other: "Other",
};
const TABLE_OPTIONS = ["", "families", "children", "payments", "users", "settings"];

export default function SettingsPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin ?? false;

  // Settings state
  const [schoolName, setSchoolName] = useState("Beit Midrash Wilrijk");
  const [methodLabels, setMethodLabels] = useState<Record<string, string>>({ ...DEFAULT_METHOD_LABELS });
  const [defaultMethod, setDefaultMethod] = useState("kas");
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");

  // Audit log state
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditTable, setAuditTable] = useState("");
  const [auditOffset, setAuditOffset] = useState(0);
  const AUDIT_LIMIT = 20;

  // Load settings
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.settings) {
          if (d.settings.school_name) setSchoolName(d.settings.school_name as string);
          if (d.settings.payment_method_labels) {
            setMethodLabels({ ...DEFAULT_METHOD_LABELS, ...(d.settings.payment_method_labels as Record<string, string>) });
          }
          if (d.settings.default_payment_method) setDefaultMethod(d.settings.default_payment_method as string);
        }
      })
      .finally(() => setSettingsLoading(false));
  }, []);

  // Load audit log
  function loadAudit(offset = 0, table = auditTable) {
    setAuditLoading(true);
    const params = new URLSearchParams({ limit: String(AUDIT_LIMIT), offset: String(offset) });
    if (table) params.set("table", table);
    fetch(`/api/audit-log?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) {
          setAuditEntries(d.entries);
          setAuditTotal(d.total);
        }
      })
      .finally(() => setAuditLoading(false));
  }

  useEffect(() => {
    if (isSuperAdmin) loadAudit(0, "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin]);

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSettingsSaving(true);
    setSettingsMsg("");
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        school_name: schoolName,
        payment_method_labels: methodLabels,
        default_payment_method: defaultMethod,
      }),
    });
    const d = await res.json();
    setSettingsMsg(res.ok ? "Settings saved." : (d.error ?? "Failed to save"));
    setSettingsSaving(false);
  }

  function handleAuditFilter(table: string) {
    setAuditTable(table);
    setAuditOffset(0);
    loadAudit(0, table);
  }

  function handleAuditPage(newOffset: number) {
    setAuditOffset(newOffset);
    loadAudit(newOffset);
  }

  const actionColor: Record<string, string> = {
    create: "bg-green-100 text-green-700",
    update: "bg-blue-100 text-blue-700",
    delete: "bg-red-100 text-red-700",
  };

  return (
    <div>
      <Header titleKey="page.settings" />
      <div className="p-6 space-y-8 max-w-3xl">

        {/* System Settings (super admin only) */}
        {isSuperAdmin && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-5">System Settings</h2>
            {settingsLoading ? (
              <p className="text-gray-400 text-sm">Loading…</p>
            ) : (
              <form onSubmit={handleSaveSettings} className="space-y-5">
                {/* School name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">School Name</label>
                  <input
                    type="text"
                    value={schoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Payment method labels */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Payment Method Labels</label>
                  <div className="grid grid-cols-2 gap-3">
                    {METHOD_KEYS.map((key) => (
                      <div key={key} className="flex items-center gap-2">
                        <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-600 w-12 text-center">{key}</span>
                        <input
                          type="text"
                          value={methodLabels[key] ?? ""}
                          onChange={(e) => setMethodLabels((p) => ({ ...p, [key]: e.target.value }))}
                          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Default payment method */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Default Payment Method</label>
                  <select
                    value={defaultMethod}
                    onChange={(e) => setDefaultMethod(e.target.value)}
                    className="w-48 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {METHOD_KEYS.map((key) => (
                      <option key={key} value={key}>{methodLabels[key] ?? key} ({key})</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-4">
                  <button
                    type="submit"
                    disabled={settingsSaving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {settingsSaving ? "Saving…" : "Save Settings"}
                  </button>
                  {settingsMsg && (
                    <span className={`text-sm ${settingsMsg.startsWith("Settings") ? "text-green-600" : "text-red-600"}`}>
                      {settingsMsg}
                    </span>
                  )}
                </div>
              </form>
            )}
          </div>
        )}

        {/* Non-admin view */}
        {!isSuperAdmin && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
            <p className="text-gray-500 text-sm">System settings are managed by the super admin.</p>
          </div>
        )}

        {/* Audit Log (super admin only) */}
        {isSuperAdmin && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Audit Log</h2>
              <select
                value={auditTable}
                onChange={(e) => handleAuditFilter(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All tables</option>
                {TABLE_OPTIONS.filter(Boolean).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {auditLoading ? (
              <p className="text-gray-400 text-sm">Loading audit log…</p>
            ) : auditEntries.length === 0 ? (
              <p className="text-gray-400 text-sm">No audit entries found.</p>
            ) : (
              <>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {auditEntries.map((entry) => (
                    <div key={entry.id} className="border border-gray-100 rounded-md p-3 hover:bg-gray-50">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded font-semibold ${actionColor[entry.action] ?? "bg-gray-100 text-gray-600"}`}>
                          {entry.action}
                        </span>
                        <span className="text-xs font-medium text-gray-700">{entry.table_name}</span>
                        {entry.users && (
                          <span className="text-xs text-gray-500">
                            by {entry.users.display_name ?? entry.users.username}
                          </span>
                        )}
                        <span className="text-xs text-gray-400 ml-auto">
                          {new Date(entry.created_at).toLocaleString("nl-BE")}
                        </span>
                      </div>
                      {entry.new_data && (
                        <details className="text-xs">
                          <summary className="text-gray-400 cursor-pointer hover:text-gray-600">View data</summary>
                          <pre className="mt-1 bg-gray-50 rounded p-2 overflow-x-auto text-gray-600">
                            {JSON.stringify(entry.new_data, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
                  <span>{auditTotal} total entries</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAuditPage(Math.max(0, auditOffset - AUDIT_LIMIT))}
                      disabled={auditOffset === 0}
                      className="px-3 py-1 border border-gray-300 rounded-md text-xs hover:bg-gray-50 disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => handleAuditPage(auditOffset + AUDIT_LIMIT)}
                      disabled={auditOffset + AUDIT_LIMIT >= auditTotal}
                      className="px-3 py-1 border border-gray-300 rounded-md text-xs hover:bg-gray-50 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
