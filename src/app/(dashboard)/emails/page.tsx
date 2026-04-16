"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Header from "@/components/Header";
import { familyDisplayName } from "@/lib/family-utils";
import { formatCurrency } from "@/lib/payment-utils";
import type { Family, Currency } from "@/lib/types";

interface FamilyWithBalance extends Family {
  balance?: number;
  currency?: Currency;
}

interface Preview {
  subject: string;
  html: string;
  bodyText: string;
  balance: number;
  currency: Currency;
}

interface SendResult {
  ok: boolean;
  to: string;
  familyId: string;
  subject: string;
  error?: string;
  balance?: number;
}

export default function EmailsPage() {
  const searchParams = useSearchParams();
  const initialPreviewId = searchParams.get("preview");
  const [families, setFamilies] = useState<FamilyWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState({ withEmail: true, withBalance: true, activeOnly: true });
  const [search, setSearch] = useState("");

  // Preview pane
  const [previewFamilyId, setPreviewFamilyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Test send
  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState("");
  const [testSending, setTestSending] = useState(false);

  // Bulk send
  const [sending, setSending] = useState(false);
  const [sendResults, setSendResults] = useState<SendResult[] | null>(null);

  useEffect(() => {
    // Load families + compute balances by hitting the per-family endpoint in
    // parallel. It's a bit more traffic than a dedicated bulk endpoint but
    // avoids introducing a new aggregation route.
    (async () => {
      const famRes = await fetch("/api/families");
      const famData = await famRes.json();
      const fams = (famData.families ?? []) as Family[];
      setFamilies(fams);
      setLoading(false);

      const balances = await Promise.all(
        fams.map(async (f) => {
          try {
            const r = await fetch(`/api/families/${f.id}`);
            if (!r.ok) return null;
            const d = await r.json();
            const charges = d.balance?.charged ?? 0;
            const paid = d.balance?.paid ?? 0;
            const firstCharge = (d.children ?? []).find((c: { currency?: Currency }) => c.currency);
            return {
              id: f.id,
              balance: charges - paid,
              currency: (firstCharge?.currency ?? "EUR") as Currency,
            };
          } catch {
            return null;
          }
        })
      );
      setFamilies((prev) =>
        prev.map((f) => {
          const b = balances.find((x) => x?.id === f.id);
          return b ? { ...f, balance: b.balance, currency: b.currency } : f;
        })
      );
    })();
  }, []);

  // If the user arrived via /emails?preview=<id> (Send-statement button on
  // the family detail page), open that family's preview immediately.
  useEffect(() => {
    if (initialPreviewId) loadPreview(initialPreviewId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPreviewId]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return families.filter((f) => {
      if (filter.activeOnly && !f.is_active) return false;
      if (filter.withEmail && !f.email) return false;
      if (filter.withBalance && (f.balance ?? 0) <= 0) return false;
      if (s) {
        const hay = `${f.name} ${f.father_name ?? ""} ${f.email ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [families, filter, search]);

  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((f) => f.id)));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function loadPreview(familyId: string) {
    setPreviewFamilyId(familyId);
    setPreview(null);
    setPreviewLoading(true);
    const r = await fetch(`/api/email/preview?familyId=${familyId}`);
    const d = await r.json();
    if (r.ok) setPreview(d);
    setPreviewLoading(false);
  }

  async function sendTest() {
    if (!previewFamilyId || !testTo.trim()) return;
    setTestSending(true);
    setTestMsg("");
    const r = await fetch("/api/email/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        familyId: previewFamilyId,
        toAddress: testTo.trim(),
      }),
    });
    const d = await r.json().catch(() => ({}));
    setTestMsg(r.ok ? `Test sent to ${testTo}.` : (d.error ?? "Test failed"));
    setTestSending(false);
  }

  async function bulkSend() {
    if (selected.size === 0) return;
    const label = `Send statement emails to ${selected.size} families?`;
    if (!confirm(label)) return;
    setSending(true);
    setSendResults(null);
    const r = await fetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ familyIds: Array.from(selected) }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) setSendResults(d.results as SendResult[]);
    else alert(d.error ?? "Send failed");
    setSending(false);
  }

  return (
    <div>
      <Header titleKey="page.emails" />
      <div className="p-6 max-w-none">
        <h1 className="text-xl font-semibold text-gray-900 mb-4">Send statements</h1>

        <div className="grid grid-cols-12 gap-6">
          {/* Left: selection + filters */}
          <section className="col-span-5 space-y-4">
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 space-y-3">
              <div className="flex gap-2 flex-wrap text-xs">
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={filter.withEmail} onChange={(e) => setFilter((p) => ({ ...p, withEmail: e.target.checked }))} />
                  Has email
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={filter.withBalance} onChange={(e) => setFilter((p) => ({ ...p, withBalance: e.target.checked }))} />
                  Has balance &gt; 0
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={filter.activeOnly} onChange={(e) => setFilter((p) => ({ ...p, activeOnly: e.target.checked }))} />
                  Active only
                </label>
              </div>
              <input
                type="text"
                placeholder="Search families…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center justify-between text-xs text-gray-600">
                <button type="button" onClick={toggleAll} className="underline hover:text-blue-700">
                  {selected.size === filtered.length && filtered.length > 0 ? "Deselect all" : "Select all"}
                </button>
                <span>
                  {selected.size} / {filtered.length} selected
                </span>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              {loading ? (
                <p className="p-4 text-sm text-gray-400">Loading families…</p>
              ) : filtered.length === 0 ? (
                <p className="p-4 text-sm text-gray-400">No families match the filters.</p>
              ) : (
                <ul className="max-h-[560px] overflow-y-auto divide-y divide-gray-100">
                  {filtered.map((f) => {
                    const isSelected = selected.has(f.id);
                    const isPreviewing = previewFamilyId === f.id;
                    return (
                      <li
                        key={f.id}
                        className={`p-3 text-sm flex items-center gap-3 hover:bg-gray-50 cursor-pointer ${
                          isPreviewing ? "bg-blue-50" : ""
                        }`}
                        onClick={() => loadPreview(f.id)}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleOne(f.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 truncate">
                            {familyDisplayName(f.name, f.father_name)}
                          </div>
                          <div className="text-xs text-gray-500 truncate">
                            {f.email ?? <em className="text-amber-600">no email</em>}
                          </div>
                        </div>
                        {f.balance !== undefined && (
                          <span
                            className={`text-xs font-mono ${
                              f.balance > 0 ? "text-red-600" : "text-gray-400"
                            }`}
                          >
                            {formatCurrency(f.balance, f.currency ?? "EUR")}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <button
              type="button"
              onClick={bulkSend}
              disabled={sending || selected.size === 0}
              className="w-full py-3 bg-green-600 text-white rounded-md text-sm font-semibold hover:bg-green-700 disabled:opacity-40"
            >
              {sending ? "Sending…" : `Send to ${selected.size} families`}
            </button>

            {sendResults && (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 text-sm">
                <div className="font-semibold mb-2">
                  Sent: {sendResults.filter((r) => r.ok).length} · Failed:{" "}
                  {sendResults.filter((r) => !r.ok).length}
                </div>
                <ul className="space-y-1 max-h-48 overflow-y-auto">
                  {sendResults.map((r, i) => (
                    <li key={i} className={`text-xs ${r.ok ? "text-gray-700" : "text-red-600"}`}>
                      {r.ok ? "✓" : "✗"} {r.to || "(no email)"}{" "}
                      {r.error && <span className="text-red-500">— {r.error}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Right: preview */}
          <section className="col-span-7 space-y-4">
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
              <div className="p-4 border-b border-gray-200 flex items-center gap-3 flex-wrap">
                <h2 className="text-sm font-semibold text-gray-900">Preview</h2>
                {previewFamilyId && (
                  <a
                    href={`/api/email/pdf?familyId=${previewFamilyId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto text-xs text-blue-600 underline"
                  >
                    Open PDF ↗
                  </a>
                )}
              </div>

              {!previewFamilyId ? (
                <p className="p-8 text-center text-sm text-gray-400">
                  Click a family on the left to preview the email + PDF.
                </p>
              ) : previewLoading ? (
                <p className="p-8 text-center text-sm text-gray-400">Loading preview…</p>
              ) : !preview ? (
                <p className="p-8 text-center text-sm text-red-500">Preview failed to load.</p>
              ) : (
                <div>
                  <div className="px-4 py-3 text-xs text-gray-500 border-b border-gray-100">
                    <div><span className="font-medium text-gray-700">Subject:</span> {preview.subject}</div>
                    <div>
                      <span className="font-medium text-gray-700">Balance:</span>{" "}
                      <span className={preview.balance > 0 ? "text-red-600 font-mono" : "font-mono"}>
                        {formatCurrency(preview.balance, preview.currency)}
                      </span>
                    </div>
                  </div>
                  <iframe
                    title="Email preview"
                    sandbox=""
                    srcDoc={preview.html}
                    className="w-full bg-white"
                    style={{ height: 360, border: 0 }}
                  />
                  <details className="px-4 py-2 border-t border-gray-100">
                    <summary className="text-xs text-gray-500 cursor-pointer">PDF preview</summary>
                    <iframe
                      title="PDF preview"
                      src={`/api/email/pdf?familyId=${previewFamilyId}`}
                      className="w-full mt-2"
                      style={{ height: 600, border: "1px solid #eee" }}
                    />
                  </details>
                </div>
              )}
            </div>

            {previewFamilyId && (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 space-y-2">
                <h3 className="text-sm font-semibold text-gray-900">Test send</h3>
                <p className="text-xs text-gray-500">
                  Sends the rendered email (using this family&rsquo;s data) to a single address of your choice.
                </p>
                <div className="flex gap-2">
                  <input
                    type="email"
                    placeholder="admin@example.com"
                    value={testTo}
                    onChange={(e) => setTestTo(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={sendTest}
                    disabled={testSending || !testTo.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-40"
                  >
                    {testSending ? "Sending…" : "Send test"}
                  </button>
                </div>
                {testMsg && (
                  <p className={`text-xs ${testMsg.startsWith("Test sent") ? "text-green-600" : "text-red-600"}`}>
                    {testMsg}
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
