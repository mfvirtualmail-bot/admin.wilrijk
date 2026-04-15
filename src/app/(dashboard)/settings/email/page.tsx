"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth-context";

const PASSWORD_MASK = "__unchanged__";

interface Settings {
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string | null;
  has_password: boolean;
  from_name: string;
  from_email: string | null;
  reply_to: string | null;
  bcc_admin: string | null;
  org_name: string;
  org_address: string | null;
  org_logo_url: string | null;
  payment_instructions: string | null;
}

export default function EmailSettingsPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin ?? false;

  const [s, setS] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [password, setPassword] = useState(PASSWORD_MASK); // sentinel = "don't change"
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    fetch("/api/email/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.settings) setS(d.settings);
      })
      .finally(() => setLoading(false));
  }, []);

  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!s) return;
    setSaving(true);
    setMsg("");
    const payload: Record<string, unknown> = { ...s };
    delete (payload as { has_password?: boolean }).has_password;
    payload.smtp_password = password; // PASSWORD_MASK means "leave existing value alone"
    const res = await fetch("/api/email/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await res.json().catch(() => ({}));
    setMsg(res.ok ? "Saved." : (d.error ?? "Failed to save"));
    if (res.ok) {
      setPassword(PASSWORD_MASK);
      // Reload to refresh has_password indicator
      const updated = await fetch("/api/email/settings").then((r) => r.json());
      if (updated.settings) setS(updated.settings);
    }
    setSaving(false);
  }

  if (!isSuperAdmin) {
    return (
      <div>
        <Header titleKey="page.settings" />
        <div className="p-6">
          <p className="text-gray-500 text-sm">Email settings are managed by the super admin.</p>
        </div>
      </div>
    );
  }

  if (loading || !s) {
    return (
      <div>
        <Header titleKey="page.settings" />
        <div className="p-6 text-sm text-gray-400">Loading…</div>
      </div>
    );
  }

  return (
    <div>
      <Header titleKey="page.settings" />
      <div className="p-6 max-w-3xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Email</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure the Gmail account used to send statements. You&rsquo;ll need a{" "}
            <a
              className="text-blue-600 underline"
              href="https://support.google.com/accounts/answer/185833"
              target="_blank"
              rel="noreferrer"
            >
              Gmail app password
            </a>{" "}
            (not the Google account password) with 2-factor authentication enabled.
          </p>
        </div>

        <form onSubmit={save} className="space-y-8">
          {/* SMTP */}
          <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Gmail SMTP</h2>

            <div className="grid grid-cols-2 gap-4">
              <Field label="SMTP host">
                <input
                  type="text"
                  value={s.smtp_host}
                  onChange={(e) => patch("smtp_host", e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="SMTP port">
                <input
                  type="number"
                  value={s.smtp_port}
                  onChange={(e) => patch("smtp_port", Number(e.target.value))}
                  className={inputCls}
                />
              </Field>
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={s.smtp_secure}
                onChange={(e) => patch("smtp_secure", e.target.checked)}
              />
              Use TLS/SSL (required for port 465)
            </label>

            <Field label="Gmail address (username)">
              <input
                type="email"
                value={s.smtp_user ?? ""}
                onChange={(e) => patch("smtp_user", e.target.value)}
                placeholder="gabbai@example.com"
                className={inputCls}
              />
            </Field>

            <Field
              label={
                <>
                  App password{" "}
                  {s.has_password && password === PASSWORD_MASK && (
                    <span className="text-xs text-green-600 ml-2">set — leave blank to keep</span>
                  )}
                </>
              }
            >
              <div className="flex gap-2">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password === PASSWORD_MASK ? "" : password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={s.has_password ? "•••• •••• •••• ••••" : "xxxx xxxx xxxx xxxx"}
                  className={inputCls + " flex-1 font-mono"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="px-3 py-2 text-xs border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
                {s.has_password && (
                  <button
                    type="button"
                    onClick={() => setPassword("")}
                    className="px-3 py-2 text-xs border border-red-300 text-red-600 rounded-md hover:bg-red-50"
                  >
                    Clear
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Google strips spaces automatically. 16 characters.
              </p>
            </Field>
          </section>

          {/* From + reply */}
          <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">From / Reply-to</h2>

            <div className="grid grid-cols-2 gap-4">
              <Field label="From name">
                <input
                  type="text"
                  value={s.from_name}
                  onChange={(e) => patch("from_name", e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="From email (defaults to Gmail address)">
                <input
                  type="email"
                  value={s.from_email ?? ""}
                  onChange={(e) => patch("from_email", e.target.value)}
                  placeholder={s.smtp_user ?? ""}
                  className={inputCls}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Reply-to (optional)">
                <input
                  type="email"
                  value={s.reply_to ?? ""}
                  onChange={(e) => patch("reply_to", e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="BCC admin (optional)">
                <input
                  type="email"
                  value={s.bcc_admin ?? ""}
                  onChange={(e) => patch("bcc_admin", e.target.value)}
                  placeholder="Receive a copy of every send"
                  className={inputCls}
                />
              </Field>
            </div>
          </section>

          {/* Branding */}
          <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Branding (email + PDF header)</h2>

            <Field label="Organisation name">
              <input
                type="text"
                value={s.org_name}
                onChange={(e) => patch("org_name", e.target.value)}
                className={inputCls}
              />
            </Field>

            <Field label="Organisation address">
              <textarea
                value={s.org_address ?? ""}
                onChange={(e) => patch("org_address", e.target.value)}
                rows={2}
                className={inputCls + " resize-y"}
                placeholder="Street · 2610 Wilrijk"
              />
            </Field>

            <Field label="Logo URL (public http(s) URL shown in email + PDF header)">
              <input
                type="url"
                value={s.org_logo_url ?? ""}
                onChange={(e) => patch("org_logo_url", e.target.value)}
                placeholder="https://example.com/logo.png"
                className={inputCls}
              />
              {s.org_logo_url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={s.org_logo_url}
                  alt="Logo preview"
                  className="h-16 mt-2 border border-gray-200 rounded bg-white p-1"
                />
              )}
            </Field>

            <Field label="Payment instructions (shown at bottom of PDF)">
              <textarea
                value={s.payment_instructions ?? ""}
                onChange={(e) => patch("payment_instructions", e.target.value)}
                rows={4}
                className={inputCls + " resize-y"}
                placeholder={"Bank: ...\nIBAN: BE...\nReference: your family name"}
              />
            </Field>
          </section>

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
            {msg && (
              <span className={`text-sm ${msg === "Saved." ? "text-green-600" : "text-red-600"}`}>{msg}</span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
