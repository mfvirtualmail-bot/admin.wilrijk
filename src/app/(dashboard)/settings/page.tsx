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

interface LatestRate {
  currency: "USD" | "GBP";
  rate: number;
  rateDate: string;
  source: FxSource;
}

function ExchangeRatesPanel() {
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [latest, setLatest] = useState<LatestRate[]>([]);
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
    setLatest(d.latest ?? []);
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
      const ins = d.inserted.length;
      const parts = [`ECB ${d.date}: ${ins} inserted, ${d.skipped.length} skipped.`];
      if (d.skipped.length > 0) {
        const reasons = (d.skipped as Array<{ currency: string; reason: string }>)
          .map((s) => `${s.currency}: ${s.reason}`)
          .join("; ");
        parts.push(reasons);
      }
      setMsg(parts.join(" "));
      load();
    }
    setRefreshing(false);
  }

  const sourceBadge = (s: FxSource) => s === "manual"
    ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 font-medium">manual</span>
    : <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">ECB</span>;

  return (
    <div className="space-y-5">
      <SnapshotStatusPanel />

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

      {/* Last-known fallback per currency. This is what the EUR
          snapshot on new payments/charges will reuse if ECB ever
          can't give us a rate for the requested date. */}
      <div className="p-3 border border-blue-200 bg-blue-50 rounded-md">
        <h4 className="text-sm font-semibold text-blue-900 mb-2">Last-known rate (fallback)</h4>
        <p className="text-xs text-blue-800 mb-3">
          If the ECB refresh ever fails, new payments and charges will be converted using
          these rates. They are also what legacy rows with a missing EUR snapshot are
          backfilled against.
        </p>
        {latest.length === 0 ? (
          <p className="text-xs text-blue-700">No rates recorded yet. Click <strong>Refresh from ECB</strong> below.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {latest.map((l) => (
              <div key={l.currency} className="bg-white border border-blue-100 rounded px-3 py-2 flex items-baseline gap-2 text-sm">
                <span className="font-semibold text-blue-900 w-10">{l.currency}</span>
                <span className="font-mono text-gray-900">{Number(l.rate).toFixed(6)}</span>
                <span className="text-xs text-gray-500 ml-auto">
                  {l.rateDate} · {l.source === "manual" ? "manual" : "ECB"}
                </span>
              </div>
            ))}
          </div>
        )}
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

// ────────────────────────────────────────────────────────────────
// Snapshot status + rebuild

interface FxStatus {
  today: string;
  rates: Array<{
    currency: "USD" | "GBP";
    rate: number;
    rateDate: string;
    source: FxSource;
    daysOld: number;
  }>;
  missingPayments: number;
  missingCharges: number;
  totalPayments: number;
  totalCharges: number;
}

function SnapshotStatusPanel() {
  const [status, setStatus] = useState<FxStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [fetchingEcb, setFetchingEcb] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/fx/status");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed to load");
      setStatus(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // --- 1. Fetch ECB rates now. Surfaces any error so the operator can
  //        see whether ECB is actually reachable from the server.
  async function handleEcb(force: boolean) {
    setFetchingEcb(true);
    setErr(null);
    setProgress("Fetching ECB rates…");
    try {
      const res = await fetch(`/api/fx/refresh${force ? "?force=1" : ""}`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "ECB refresh failed");
      const ins = (d.inserted as Array<{ currency: string }>).length;
      const skipped = (d.skipped as Array<{ currency: string; reason: string }>) ?? [];
      const parts = [`ECB ${d.date}: ${ins} inserted`];
      if (skipped.length > 0) {
        parts.push(
          "skipped: " + skipped.map((s) => `${s.currency} (${s.reason})`).join(", "),
        );
      }
      setProgress(parts.join(" — "));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setFetchingEcb(false);
      load();
    }
  }

  // --- 2. Regenerate charge rows for every active student across the
  //        last few academic years. Fixes the "family shows €0 charged"
  //        case where the original /api/children POST silently swallowed
  //        a charge-generation failure.
  async function handleRegenerateCharges() {
    if (!confirm(
      "Regenerate monthly charges for ALL active students across the last few academic years? " +
      "Existing charges are preserved — only missing months will be created.",
    )) return;
    setRegenerating(true);
    setErr(null);
    setProgress("Regenerating charges for all students…");
    try {
      const res = await fetch("/api/charges/regenerate-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ years: 3 }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Regenerate failed");
      const parts = [
        `Created ${d.created} charge(s) across ${d.studentsProcessed} student(s)`,
      ];
      if (d.studentsSkipped > 0) parts.push(`${d.studentsSkipped} skipped (no tuition)`);
      if ((d.failures as unknown[]).length > 0) {
        parts.push(`${(d.failures as unknown[]).length} student(s) failed`);
      }
      parts.push(`covering years ${(d.academicYearsCovered as number[]).join(", ")}`);
      setProgress(parts.join(" — "));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRegenerating(false);
      load();
    }
  }

  // --- 3. Rebuild eur_amount for all payment/charge rows that are NULL.
  //        Loops the batched endpoint until nothing remains. Stops if a
  //        pass writes zero rows (means no rate is available — user
  //        needs to add one manually or fetch ECB first).
  async function handleRebuild() {
    setRebuilding(true);
    setErr(null);
    setProgress("Starting…");
    let totalPayments = 0;
    let totalCharges = 0;
    try {
      for (let i = 0; i < 40; i++) {
        const res = await fetch("/api/fx/rebuild-snapshots?limit=500", { method: "POST" });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error ?? "Rebuild failed");
        totalPayments += d.updatedPayments ?? 0;
        totalCharges += d.updatedCharges ?? 0;
        const remaining = (d.remainingPayments ?? 0) + (d.remainingCharges ?? 0);
        setProgress(
          `Pass ${i + 1}: wrote ${d.updatedPayments} payment(s) + ${d.updatedCharges} charge(s); ${remaining} row(s) still pending`,
        );
        if (remaining === 0) break;
        if ((d.updatedPayments ?? 0) + (d.updatedCharges ?? 0) === 0) {
          throw new Error(
            `Stopped — ${remaining} row(s) still have no usable rate. Fetch ECB above or add the missing rate in the Exchange Rates table below.`,
          );
        }
      }
      setProgress(`Done. Wrote ${totalPayments} payment(s) + ${totalCharges} charge(s).`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRebuilding(false);
      load();
    }
  }

  const anyMissing = status && (status.missingPayments > 0 || status.missingCharges > 0);
  const ratesStale = status?.rates.some((r) => r.daysOld > 7) ?? false;
  const noRates = (status?.rates.length ?? 0) === 0;
  const anyBusy = rebuilding || regenerating || fetchingEcb;

  return (
    <div className="border border-gray-200 rounded-md p-4 bg-white">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Data integrity</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Three one-shot actions for when dashboard/reports totals look wrong.
            All of them are idempotent — running twice won&apos;t duplicate anything.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-xs text-blue-600 hover:underline disabled:opacity-40"
        >
          Refresh
        </button>
      </div>

      {loading && !status && <p className="text-sm text-gray-400">Loading…</p>}

      {status && (
        <div className="space-y-4">
          {/* Live numbers. */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className={`rounded border p-3 ${status.missingPayments > 0 ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50"}`}>
              <div className="text-xs text-gray-600">Payments without EUR snapshot</div>
              <div className="text-xl font-bold text-gray-900">
                {status.missingPayments.toLocaleString()}{" "}
                <span className="text-sm font-normal text-gray-500">
                  / {status.totalPayments.toLocaleString()}
                </span>
              </div>
            </div>
            <div className={`rounded border p-3 ${status.missingCharges > 0 ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50"}`}>
              <div className="text-xs text-gray-600">Charges without EUR snapshot</div>
              <div className="text-xl font-bold text-gray-900">
                {status.missingCharges.toLocaleString()}{" "}
                <span className="text-sm font-normal text-gray-500">
                  / {status.totalCharges.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* ECB rate status. */}
          <div
            className={
              "rounded border p-3 " +
              (noRates
                ? "border-red-200 bg-red-50"
                : ratesStale
                  ? "border-amber-200 bg-amber-50"
                  : "border-gray-200 bg-gray-50")
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div className="text-xs text-gray-700 flex-1">
                <div className="font-semibold mb-0.5">ECB rates</div>
                {noRates ? (
                  <span>No USD or GBP rate is stored. Foreign-currency rows
                    will save with NULL eur_amount until you fetch rates.</span>
                ) : (
                  <>
                    {status.rates.map((r, i) => (
                      <span key={r.currency} className="inline-block">
                        {i > 0 && " · "}
                        <strong>{r.currency}</strong> {Number(r.rate).toFixed(4)}{" "}
                        <span className={r.daysOld > 7 ? "text-red-600" : "text-gray-500"}>
                          ({r.rateDate}, {r.daysOld}d old)
                        </span>
                      </span>
                    ))}
                  </>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handleEcb(false)}
                  disabled={anyBusy}
                  className="px-2.5 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {fetchingEcb ? "Fetching…" : "Fetch ECB now"}
                </button>
                <button
                  onClick={() => handleEcb(true)}
                  disabled={anyBusy}
                  title="Overwrite today's rate even if one is already stored"
                  className="px-2.5 py-1 border border-gray-300 text-gray-700 rounded text-xs hover:bg-white disabled:opacity-50"
                >
                  Force
                </button>
              </div>
            </div>
          </div>

          {/* Action buttons. */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleRegenerateCharges}
                disabled={anyBusy}
                className="px-3 py-1.5 bg-purple-600 text-white rounded-md text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
                title="Creates monthly charge rows for every active student, covering the last 3 academic years. Safe to run repeatedly."
              >
                {regenerating ? "Regenerating…" : "Regenerate charges for all students"}
              </button>
              <button
                onClick={handleRebuild}
                disabled={anyBusy || !anyMissing}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                title="Computes and persists eur_amount for every payment/charge row that's still NULL."
              >
                {rebuilding ? "Rebuilding…" : anyMissing ? "Rebuild EUR snapshots" : "Snapshots complete"}
              </button>
            </div>
            <p className="text-[11px] text-gray-500">
              Recommended order: <strong>Fetch ECB</strong> →{" "}
              <strong>Regenerate charges</strong> → <strong>Rebuild EUR snapshots</strong>.
            </p>
          </div>

          {progress && (
            <div className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded p-2 font-mono">
              {progress}
            </div>
          )}

          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {err}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
