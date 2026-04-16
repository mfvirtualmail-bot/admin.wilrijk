"use client";

import { useEffect, useRef, useState } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth-context";

type Locale = "en" | "yi";

interface Template {
  locale: Locale;
  subject: string;
  body: string;
  updated_at?: string;
}

const PLACEHOLDERS = [
  { key: "family_name", desc: "Family surname" },
  { key: "hebrew_family_name", desc: "Hebrew family name" },
  { key: "contact_name", desc: "Father/mother name" },
  { key: "balance", desc: "Balance due (formatted)" },
  { key: "total_charged", desc: "Total charged" },
  { key: "total_paid", desc: "Total paid" },
  { key: "statement_date", desc: "Today (yyyy-mm-dd)" },
  { key: "org_name", desc: "Organisation name" },
  { key: "children_names", desc: "Child names, comma-separated" },
];

const DEFAULTS: Record<Locale, Template> = {
  en: { locale: "en", subject: "Tuition statement — {{family_name}}", body: "Dear {{contact_name}},\n\nPlease find attached the tuition statement dated {{statement_date}}.\n\nCurrent balance: {{balance}}.\n\nThank you,\n{{org_name}}" },
  yi: { locale: "yi", subject: "שכר לימוד — {{family_name}}", body: "חשובע משפחה {{contact_name}},\n\nצוגעבונדן דעם חשבון, מיטן דאַטום {{statement_date}}.\n\nחוב: {{balance}}.\n\nאַ דאַנק,\n{{org_name}}" },
};

export default function EmailTemplatesPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin ?? false;

  const [locale, setLocale] = useState<Locale>("en");
  const [templates, setTemplates] = useState<Record<Locale, Template>>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const [focusField, setFocusField] = useState<"subject" | "body">("body");

  useEffect(() => {
    fetch("/api/email/templates")
      .then((r) => r.json())
      .then((d) => {
        if (d.templates) {
          setTemplates((prev) => ({
            en: d.templates.en ?? prev.en,
            yi: d.templates.yi ?? prev.yi,
          }));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const t = templates[locale];
  const rtl = locale === "yi";

  function updateCurrent(patch: Partial<Template>) {
    setTemplates((prev) => ({ ...prev, [locale]: { ...prev[locale], ...patch } }));
  }

  function insertPlaceholder(p: string) {
    const token = `{{${p}}}`;
    if (focusField === "subject") {
      const el = subjectRef.current;
      if (!el) return updateCurrent({ subject: t.subject + token });
      const start = el.selectionStart ?? t.subject.length;
      const end = el.selectionEnd ?? start;
      const next = t.subject.slice(0, start) + token + t.subject.slice(end);
      updateCurrent({ subject: next });
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      const el = bodyRef.current;
      if (!el) return updateCurrent({ body: t.body + token });
      const start = el.selectionStart ?? t.body.length;
      const end = el.selectionEnd ?? start;
      const next = t.body.slice(0, start) + token + t.body.slice(end);
      updateCurrent({ body: next });
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    }
  }

  async function save() {
    setSaving(true);
    setMsg("");
    const res = await fetch("/api/email/templates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: t.locale, subject: t.subject, body: t.body }),
    });
    const d = await res.json().catch(() => ({}));
    setMsg(res.ok ? "Saved." : (d.error ?? "Failed to save"));
    setSaving(false);
  }

  if (!isSuperAdmin) {
    return (
      <div>
        <Header titleKey="page.settings" />
        <div className="p-6 text-sm text-gray-500">Email templates are managed by the super admin.</div>
      </div>
    );
  }

  return (
    <div>
      <Header titleKey="page.settings" />
      <div className="p-6 max-w-5xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Email templates</h1>
          <p className="text-sm text-gray-500 mt-1">
            Write the email text parents will receive. Use{" "}
            <code className="font-mono bg-gray-100 px-1 rounded">{"{{placeholders}}"}</code>{" "}
            to insert family-specific values. Blank lines become paragraph breaks.
          </p>
        </div>

        {/* Locale tabs */}
        <div className="flex gap-2 border-b border-gray-200">
          {(["en", "yi"] as Locale[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
                locale === l ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {l === "en" ? "English" : "ייִדיש (Yiddish)"}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-gray-400 text-sm">Loading…</p>
        ) : (
          <div className="grid grid-cols-3 gap-6">
            {/* Editor */}
            <div className="col-span-2 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                <input
                  ref={subjectRef}
                  type="text"
                  value={t.subject}
                  onChange={(e) => updateCurrent({ subject: e.target.value })}
                  onFocus={() => setFocusField("subject")}
                  dir={rtl ? "rtl" : "ltr"}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
                <textarea
                  ref={bodyRef}
                  rows={16}
                  value={t.body}
                  onChange={(e) => updateCurrent({ body: e.target.value })}
                  onFocus={() => setFocusField("body")}
                  dir={rtl ? "rtl" : "ltr"}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-sans focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                  style={rtl ? { fontFamily: "'Noto Sans Hebrew', Arial, sans-serif" } : undefined}
                />
              </div>

              <div className="flex gap-3 items-center">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="px-5 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : `Save ${locale.toUpperCase()} template`}
                </button>
                {msg && (
                  <span className={`text-sm ${msg === "Saved." ? "text-green-600" : "text-red-600"}`}>{msg}</span>
                )}
              </div>
            </div>

            {/* Placeholder palette */}
            <aside className="bg-gray-50 rounded-lg border border-gray-200 p-4 h-fit sticky top-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">Placeholders</h3>
              <p className="text-xs text-gray-500 mb-3">Click to insert at cursor.</p>
              <ul className="space-y-1.5">
                {PLACEHOLDERS.map((p) => (
                  <li key={p.key}>
                    <button
                      type="button"
                      onClick={() => insertPlaceholder(p.key)}
                      className="w-full text-left px-2 py-1 rounded hover:bg-white border border-transparent hover:border-gray-300 text-xs"
                    >
                      <code className="font-mono text-blue-700">{`{{${p.key}}}`}</code>
                      <div className="text-gray-500 text-[11px]">{p.desc}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
