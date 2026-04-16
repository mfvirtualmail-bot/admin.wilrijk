"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth-context";
import type { ExchangeRate, FxSource } from "@/lib/types";

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

/** Built-in method keys that cannot be deleted, only relabelled. */
const BUILTIN_METHOD_KEYS = ["crc", "kas", "bank", "other"] as const;
const DEFAULT_METHOD_LABELS: Record<string, string> = {
  crc: "Credit Card",
  kas: "Cash",
  bank: "Bank Transfer",
  other: "Other",
};
/** Only lowercase letters, digits and underscore — this ends up stored as
 * the raw payment_method value in the DB, so keep it short and stable. */
const METHOD_KEY_RE = /^[a-z0-9_]{1,20}$/;
const TABLE_OPTIONS = ["", "families", "children", "payments", "users", "settings"];

type TabId = "general" | "methods" | "advanced";

export default function SettingsPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin ?? false;

  const [tab, setTab] = useState<TabId>("general");

  // Honor `#general|#methods|#advanced` in the URL so deep links from
  // other pages (e.g. "Add rates in Advanced Settings") land on the
  // right tab instead of the default one.
  useEffect(() => {
    const applyHash = () => {
      const h = window.location.hash.replace("#", "");
      if (h === "general" || h === "methods" || h === "advanced") setTab(h);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  // Settings state
  const [schoolName, setSchoolName] = useState("Beit Midrash Wilrijk");
  const [methodLabels, setMethodLabels] = useState<Record<string, string>>({ ...DEFAULT_METHOD_LABELS });
  const [defaultMethod, setDefaultMethod] = useState("kas");
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");

  // New-method input
  const [newMethodKey, setNewMethodKey] = useState("");
  const [newMethodLabel, setNewMethodLabel] = useState("");

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

  const tabs: { id: TabId; label: string }[] = [
    { id: "general", label: "General" },
    { id: "methods", label: "Payment Methods" },
    { id: "advanced", label: "Advanced" },
  ];

  return (
    <div>
      <Header titleKey="page.settings" />
      <div className="p-6 space-y-8 max-w-3xl">

        {!isSuperAdmin && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
            <p className="text-gray-500 text-sm">System settings are managed by the super admin.</p>
          </div>
        )}

        {isSuperAdmin && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            {/* Tabs */}
            <div className="flex border-b border-gray-200">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px ${
                    tab === t.id
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-800"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="p-6">
              {/* GENERAL + PAYMENT METHODS share the same save button / form */}
              {(tab === "general" || tab === "methods") && (
                settingsLoading ? (
                  <p className="text-gray-400 text-sm">Loading…</p>
                ) : (
                  <form onSubmit={handleSaveSettings} className="space-y-5">
                    {tab === "general" && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">School Name</label>
                        <input
                          type="text"
                          value={schoolName}
                          onChange={(e) => setSchoolName(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    )}

                    {tab === "methods" && (
                      <>
                        {/* Payment method labels */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Payment Methods</label>
                          <p className="text-xs text-gray-500 mb-3">
                            The four codes <code className="font-mono bg-gray-100 px-1 rounded">crc</code>,
                            <code className="font-mono bg-gray-100 px-1 rounded">kas</code>,
                            <code className="font-mono bg-gray-100 px-1 rounded">bank</code> and
                            <code className="font-mono bg-gray-100 px-1 rounded">other</code> are built-in and
                            cannot be removed, only renamed. You can add your own codes below.
                          </p>
                          <div className="space-y-2">
                            {Object.keys(methodLabels).map((key) => {
                              const isBuiltin = (BUILTIN_METHOD_KEYS as readonly string[]).includes(key);
                              return (
                                <div key={key} className="flex items-center gap-2">
                                  <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-600 w-20 text-center shrink-0">
                                    {key}
                                  </span>
                                  <input
                                    type="text"
                                    value={methodLabels[key] ?? ""}
                                    onChange={(e) => setMethodLabels((p) => ({ ...p, [key]: e.target.value }))}
                                    placeholder="Label shown in forms"
                                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                  {isBuiltin ? (
                                    <span className="text-[11px] text-gray-400 w-16 text-right">built-in</span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setMethodLabels((prev) => {
                                          const next = { ...prev };
                                          delete next[key];
                                          return next;
                                        });
                                        if (defaultMethod === key) setDefaultMethod("kas");
                                      }}
                                      className="text-xs text-red-500 hover:text-red-700 w-16 text-right"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* Add new method row */}
                          <div className="mt-3 p-3 border border-dashed border-gray-300 rounded-md bg-gray-50 flex items-end gap-2 flex-wrap">
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Code</label>
                              <input
                                type="text"
                                value={newMethodKey}
                                onChange={(e) => setNewMethodKey(e.target.value.toLowerCase())}
                                placeholder="e.g. paypal"
                                maxLength={20}
                                className="w-32 px-3 py-1.5 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <div className="flex-1 min-w-[12rem]">
                              <label className="block text-xs font-medium text-gray-600 mb-1">Label</label>
                              <input
                                type="text"
                                value={newMethodLabel}
                                onChange={(e) => setNewMethodLabel(e.target.value)}
                                placeholder="PayPal"
                                className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <button
                              type="button"
                              disabled={
                                !METHOD_KEY_RE.test(newMethodKey) ||
                                !newMethodLabel.trim() ||
                                newMethodKey in methodLabels
                              }
                              onClick={() => {
                                setMethodLabels((prev) => ({
                                  ...prev,
                                  [newMethodKey]: newMethodLabel.trim(),
                                }));
                                setNewMethodKey("");
                                setNewMethodLabel("");
                              }}
                              className="px-3 py-1.5 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 disabled:opacity-40"
                            >
                              + Add
                            </button>
                          </div>
                          {newMethodKey && !METHOD_KEY_RE.test(newMethodKey) && (
                            <p className="text-xs text-red-500 mt-1">
                              Code must be 1–20 lowercase letters, digits or underscores.
                            </p>
                          )}
                          {newMethodKey && newMethodKey in methodLabels && (
                            <p className="text-xs text-red-500 mt-1">That code already exists.</p>
                          )}
                        </div>

                        {/* Default payment method */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Default Payment Method</label>
                          <select
                            value={defaultMethod}
                            onChange={(e) => setDefaultMethod(e.target.value)}
                            className="w-60 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {Object.keys(methodLabels).map((key) => (
                              <option key={key} value={key}>{methodLabels[key] ?? key} ({key})</option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}

                    <div className="flex items-center gap-4 pt-2">
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
                )
              )}

              {tab === "advanced" && <ExchangeRatesPanel />}
            </div>
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

// ────────────────────────────────────────────────────────────────
// Advanced tab: exchange rates table

function ExchangeRatesPanel() {
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Add / edit form
  const today = new Date().toISOString().slice(0, 10);
  const [newDate, setNewDate] = useState(today);
  const [newCurrency, setNewCurrency] = useState<"USD" | "GBP">("GBP");
  const [newRate, setNewRate] = useState("");

  // Filter
  const [filterCurrency, setFilterCurrency] = useState<string>("");

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterCurrency) params.set("currency", filterCurrency);
    const res = await fetch(`/api/fx/rates?${params}`);
    const d = await res.json();
    setRates(d.rates ?? []);
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [filterCurrency]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const rate = Number(newRate);
    if (!isFinite(rate) || rate <= 0) { setMsg("Invalid rate"); return; }
    const res = await fetch("/api/fx/rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: newDate, currency: newCurrency, rate, source: "manual" }),
    });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error ?? "Failed to save rate"); return; }
    setMsg(`Saved ${newCurrency} ${rate} for ${newDate}.`);
    setNewRate("");
    load();
  }

  async function handleDelete(date: string, currency: string) {
    if (!confirm(`Delete the ${currency} rate for ${date}?`)) return;
    const res = await fetch(`/api/fx/rates/${date}/${currency}`, { method: "DELETE" });
    if (res.ok) load();
  }

  async function handleRefresh(force = false) {
    setRefreshing(true);
    setMsg("");
    const res = await fetch(`/api/fx/refresh${force ? "?force=1" : ""}`, { method: "POST" });
    const d = await res.json();
    if (!res.ok) {
      setMsg(d.error ?? "Refresh failed");
    } else {
      setMsg(`ECB ${d.date}: ${d.inserted.length} inserted, ${d.skipped.length} skipped.`);
      load();
    }
    setRefreshing(false);
  }

  const sourceBadge = (s: FxSource) => s === "manual"
    ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 font-medium">manual</span>
    : <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">ECB</span>;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-1">Exchange Rates</h3>
        <p className="text-xs text-gray-500">
          Rates are the amount of <code>USD</code>/<code>GBP</code> per 1 EUR, as published by
          the European Central Bank. When a payment&apos;s date falls on a weekend or a
          holiday without a published rate, the system falls back to the last published
          rate before it. You can add a manual row for any date to override the ECB rate
          or fill a gap.
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => handleRefresh(false)}
          disabled={refreshing}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh from ECB"}
        </button>
        <button
          onClick={() => handleRefresh(true)}
          disabled={refreshing}
          className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50"
          title="Overwrite today's rate even if one already exists"
        >
          Force refresh
        </button>
        <select
          value={filterCurrency}
          onChange={(e) => setFilterCurrency(e.target.value)}
          className="ml-auto px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All currencies</option>
          <option value="USD">USD</option>
          <option value="GBP">GBP</option>
        </select>
      </div>

      {msg && (
        <div className={`text-sm ${msg.startsWith("Saved") || msg.startsWith("ECB") ? "text-green-700" : "text-red-600"}`}>
          {msg}
        </div>
      )}

      {/* Add / override row */}
      <form onSubmit={handleAdd} className="p-3 border border-dashed border-gray-300 rounded-md bg-gray-50 flex items-end gap-2 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Currency</label>
          <select
            value={newCurrency}
            onChange={(e) => setNewCurrency(e.target.value as "USD" | "GBP")}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="GBP">GBP</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Rate (per 1 EUR)</label>
          <input
            type="number"
            value={newRate}
            onChange={(e) => setNewRate(e.target.value)}
            step="0.000001"
            min="0"
            placeholder="0.854000"
            className="w-36 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          className="px-3 py-1.5 bg-green-600 text-white rounded-md text-sm hover:bg-green-700"
        >
          + Add / Override
        </button>
      </form>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : rates.length === 0 ? (
        <p className="text-gray-400 text-sm">
          No exchange rates yet. Click <strong>Refresh from ECB</strong> to load today&apos;s rates.
        </p>
      ) : (
        <div className="border border-gray-200 rounded-md max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-gray-600">Date</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600">Currency</th>
                <th className="text-right px-3 py-2 font-semibold text-gray-600">Rate (per 1 EUR)</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600">Source</th>
                <th className="text-right px-3 py-2 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rates.map((r) => (
                <tr key={`${r.date}-${r.currency}`}>
                  <td className="px-3 py-2 text-gray-700 font-mono">{r.date}</td>
                  <td className="px-3 py-2 font-medium">{r.currency}</td>
                  <td className="px-3 py-2 text-right text-gray-700 font-mono">{Number(r.rate).toFixed(6)}</td>
                  <td className="px-3 py-2">{sourceBadge(r.source)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => handleDelete(r.date, r.currency)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
