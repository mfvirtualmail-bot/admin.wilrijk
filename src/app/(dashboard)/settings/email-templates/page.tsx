"use client";

import { useEffect, useRef, useState } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth-context";
import { TEMPLATE_PLACEHOLDERS } from "@/lib/email-render";

interface Template {
  subject: string;
  body: string;
  updated_at?: string;
}

const DEFAULT_TEMPLATE: Template = {
  subject: "שכר לימוד — {{hebrew_family_name}}",
  body: "חשובע משפחה {{hebrew_contact_name}},\n\nצוגעבונדן דעם חשבון, מיטן דאַטום {{statement_date}}.\n\nחוב: {{balance}}.\n\nאַ דאַנק,\n{{org_name}}",
};

export default function EmailTemplatesPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin ?? false;

  const [template, setTemplate] = useState<Template>(DEFAULT_TEMPLATE);
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
        if (d.template) {
          setTemplate({
            subject: d.template.subject ?? DEFAULT_TEMPLATE.subject,
            body: d.template.body ?? DEFAULT_TEMPLATE.body,
            updated_at: d.template.updated_at,
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  function update(patch: Partial<Template>) {
    setTemplate((prev) => ({ ...prev, ...patch }));
  }

  function insertPlaceholder(p: string) {
    const token = `{{${p}}}`;
    if (focusField === "subject") {
      const el = subjectRef.current;
      if (!el) return update({ subject: template.subject + token });
      const start = el.selectionStart ?? template.subject.length;
      const end = el.selectionEnd ?? start;
      const next = template.subject.slice(0, start) + token + template.subject.slice(end);
      update({ subject: next });
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      const el = bodyRef.current;
      if (!el) return update({ body: template.body + token });
      const start = el.selectionStart ?? template.body.length;
      const end = el.selectionEnd ?? start;
      const next = template.body.slice(0, start) + token + template.body.slice(end);
      update({ body: next });
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
      body: JSON.stringify({ subject: template.subject, body: template.body }),
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
          <h1 className="text-xl font-semibold text-gray-900">Email template</h1>
          <p className="text-sm text-gray-500 mt-1">
            Write the email text parents will receive. Use{" "}
            <code className="font-mono bg-gray-100 px-1 rounded">{"{{placeholders}}"}</code>{" "}
            to insert family-specific values. Blank lines become paragraph breaks.
          </p>
        </div>

        {loading ? (
          <p className="text-gray-400 text-sm">Loading…</p>
        ) : (
          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                <input
                  ref={subjectRef}
                  type="text"
                  value={template.subject}
                  onChange={(e) => update({ subject: e.target.value })}
                  onFocus={() => setFocusField("subject")}
                  dir="rtl"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
                <textarea
                  ref={bodyRef}
                  rows={16}
                  value={template.body}
                  onChange={(e) => update({ body: e.target.value })}
                  onFocus={() => setFocusField("body")}
                  dir="rtl"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-sans focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                  style={{ fontFamily: "'Noto Sans Hebrew', Arial, sans-serif" }}
                />
              </div>

              <div className="flex gap-3 items-center">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="px-5 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save template"}
                </button>
                {msg && (
                  <span className={`text-sm ${msg === "Saved." ? "text-green-600" : "text-red-600"}`}>{msg}</span>
                )}
              </div>
            </div>

            <aside className="bg-gray-50 rounded-lg border border-gray-200 p-4 h-fit sticky top-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">Placeholders</h3>
              <p className="text-xs text-gray-500 mb-3">Click to insert at cursor.</p>
              <ul className="space-y-1.5">
                {TEMPLATE_PLACEHOLDERS.map((p) => (
                  <li key={p.key}>
                    <button
                      type="button"
                      onClick={() => insertPlaceholder(p.key)}
                      className="w-full text-left px-2 py-1 rounded hover:bg-white border border-transparent hover:border-gray-300 text-xs"
                    >
                      <code className="font-mono text-blue-700">{`{{${p.key}}}`}</code>
                      <div className="text-gray-500 text-[11px]">{p.description}</div>
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
