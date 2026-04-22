"use client";

import { useEffect, useRef, useState } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth-context";
import { TEMPLATE_PLACEHOLDERS } from "@/lib/email-render";

interface Template {
  id: string;
  name: string;
  locale: "en" | "yi";
  subject: string;
  body: string;
  is_default: boolean;
  sort_order: number;
  updated_at?: string;
}

const BLANK_TEMPLATE: Omit<Template, "id" | "updated_at"> = {
  name: "",
  locale: "yi",
  subject: "",
  body: "",
  is_default: false,
  sort_order: 100,
};

export default function EmailTemplatesPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin ?? false;

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Template | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const [focusField, setFocusField] = useState<"subject" | "body">("body");

  async function load(preferId?: string | null) {
    setLoading(true);
    try {
      const r = await fetch("/api/email/templates");
      const d = await r.json();
      const list = (d.templates ?? []) as Template[];
      setTemplates(list);
      const pick = preferId && list.find((t) => t.id === preferId)
        ? preferId
        : (list.find((t) => t.is_default)?.id ?? list[0]?.id ?? null);
      setSelectedId(pick);
      setDraft(pick ? { ...list.find((t) => t.id === pick)! } : null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isSuperAdmin) load();
  }, [isSuperAdmin]);

  function selectTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSelectedId(id);
    setDraft({ ...t });
    setMsg("");
  }

  function startNew() {
    setSelectedId(null);
    setDraft({ id: "", ...BLANK_TEMPLATE, name: "New template" });
    setMsg("");
  }

  function update(patch: Partial<Template>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function insertPlaceholder(p: string) {
    if (!draft) return;
    const token = `{{${p}}}`;
    if (focusField === "subject") {
      const el = subjectRef.current;
      if (!el) return update({ subject: draft.subject + token });
      const start = el.selectionStart ?? draft.subject.length;
      const end = el.selectionEnd ?? start;
      update({ subject: draft.subject.slice(0, start) + token + draft.subject.slice(end) });
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      const el = bodyRef.current;
      if (!el) return update({ body: draft.body + token });
      const start = el.selectionStart ?? draft.body.length;
      const end = el.selectionEnd ?? start;
      update({ body: draft.body.slice(0, start) + token + draft.body.slice(end) });
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    }
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim() || !draft.subject.trim() || !draft.body.trim()) {
      setMsg("Name, subject and body are required.");
      return;
    }
    setSaving(true);
    setMsg("");
    const isNew = !draft.id;
    const url = isNew ? "/api/email/templates" : `/api/email/templates/${draft.id}`;
    const method = isNew ? "POST" : "PUT";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name.trim(),
        subject: draft.subject.trim(),
        body: draft.body,
        locale: draft.locale,
        is_default: draft.is_default,
        sort_order: draft.sort_order,
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg("Saved.");
      await load(d.template?.id ?? draft.id);
    } else {
      setMsg(d.error ?? "Failed to save");
    }
    setSaving(false);
  }

  async function setAsDefault() {
    if (!draft?.id) return;
    setSaving(true);
    const res = await fetch(`/api/email/templates/${draft.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default: true }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg("Default updated.");
      await load(draft.id);
    } else {
      setMsg(d.error ?? "Failed");
    }
    setSaving(false);
  }

  async function remove() {
    if (!draft?.id) return;
    if (!confirm(`Delete template "${draft.name}"?`)) return;
    setSaving(true);
    const res = await fetch(`/api/email/templates/${draft.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg("Deleted.");
      await load(null);
    } else {
      setMsg(d.error ?? "Failed to delete");
    }
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
      <div className="p-6 max-w-6xl space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Email templates</h1>
            <p className="text-sm text-gray-500 mt-1">
              Keep several named templates — monthly statement, former student, holiday greeting, reminders.{" "}
              Use <code className="font-mono bg-gray-100 px-1 rounded">{"{{placeholders}}"}</code> to insert family-specific values.
              Blank lines become paragraph breaks.
            </p>
          </div>
          <button
            type="button"
            onClick={startNew}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
          >
            + New template
          </button>
        </div>

        {loading ? (
          <p className="text-gray-400 text-sm">Loading…</p>
        ) : (
          <div className="grid grid-cols-12 gap-6">
            {/* Left: template list */}
            <aside className="col-span-3 bg-gray-50 rounded-lg border border-gray-200 overflow-hidden h-fit sticky top-4">
              <ul className="divide-y divide-gray-200">
                {templates.length === 0 && (
                  <li className="p-3 text-xs text-gray-400 italic">No templates yet.</li>
                )}
                {templates.map((t) => {
                  const isActive = t.id === selectedId;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => selectTemplate(t.id)}
                        className={`w-full text-left px-3 py-2.5 text-sm ${
                          isActive ? "bg-white font-medium text-blue-700" : "hover:bg-white text-gray-800"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate flex-1">{t.name}</span>
                          {t.is_default && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">
                              default
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
                {draft && !draft.id && (
                  <li className="px-3 py-2.5 text-sm bg-white italic text-blue-700 border-t border-blue-200">
                    · New template (unsaved)
                  </li>
                )}
              </ul>
            </aside>

            {/* Middle: editor */}
            {draft ? (
              <div className="col-span-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Template name</label>
                    <input
                      type="text"
                      value={draft.name}
                      onChange={(e) => update({ name: e.target.value })}
                      placeholder="e.g. Monthly statement"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Language</label>
                    <select
                      value={draft.locale}
                      onChange={(e) => update({ locale: e.target.value as "en" | "yi" })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="yi">Yiddish (RTL)</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Sort order</label>
                    <input
                      type="number"
                      value={draft.sort_order}
                      onChange={(e) => update({ sort_order: Number(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                  <input
                    ref={subjectRef}
                    type="text"
                    value={draft.subject}
                    onChange={(e) => update({ subject: e.target.value })}
                    onFocus={() => setFocusField("subject")}
                    dir={draft.locale === "yi" ? "rtl" : "ltr"}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
                  <textarea
                    ref={bodyRef}
                    rows={16}
                    value={draft.body}
                    onChange={(e) => update({ body: e.target.value })}
                    onFocus={() => setFocusField("body")}
                    dir={draft.locale === "yi" ? "rtl" : "ltr"}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-sans focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                    style={{ fontFamily: "'Noto Sans Hebrew', Arial, sans-serif" }}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="px-5 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? "Saving…" : draft.id ? "Save changes" : "Create template"}
                  </button>
                  {draft.id && !draft.is_default && (
                    <button
                      type="button"
                      onClick={setAsDefault}
                      disabled={saving}
                      className="px-4 py-2 bg-amber-50 text-amber-800 border border-amber-200 rounded-md text-sm font-medium hover:bg-amber-100 disabled:opacity-50"
                    >
                      Set as default
                    </button>
                  )}
                  {draft.id && !draft.is_default && (
                    <button
                      type="button"
                      onClick={remove}
                      disabled={saving}
                      className="px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-md text-sm font-medium hover:bg-red-100 disabled:opacity-50 ml-auto"
                    >
                      Delete
                    </button>
                  )}
                  {msg && (
                    <span className={`text-sm ${msg === "Saved." || msg === "Deleted." || msg === "Default updated." ? "text-green-600" : "text-red-600"}`}>
                      {msg}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="col-span-6 text-sm text-gray-400 italic">Select a template or create a new one.</div>
            )}

            {/* Right: placeholders */}
            <aside className="col-span-3 bg-gray-50 rounded-lg border border-gray-200 p-4 h-fit sticky top-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">Placeholders</h3>
              <p className="text-xs text-gray-500 mb-3">Click to insert at cursor.</p>
              <ul className="space-y-1.5">
                {TEMPLATE_PLACEHOLDERS.map((p) => (
                  <li key={p.key}>
                    <button
                      type="button"
                      onClick={() => insertPlaceholder(p.key)}
                      disabled={!draft}
                      className="w-full text-left px-2 py-1 rounded hover:bg-white border border-transparent hover:border-gray-300 text-xs disabled:opacity-40"
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
