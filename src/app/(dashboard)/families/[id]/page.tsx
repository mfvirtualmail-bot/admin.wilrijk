"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth-context";
import { METHOD_LABELS, METHOD_COLORS, MONTHS, formatDate, formatEur } from "@/lib/payment-utils";
import type { Family, Child, Payment, PaymentMethod } from "@/lib/types";

interface FamilyData {
  family: Family;
  children: Child[];
  payments: Payment[];
  balance: { charged: number; paid: number; due: number };
}

const ACADEMIC_MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7];

export default function FamilyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [data, setData] = useState<FamilyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Edit family form
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<Partial<Family>>({});
  const [saving, setSaving] = useState(false);

  // Add child form
  const [showAddChild, setShowAddChild] = useState(false);
  const [childForm, setChildForm] = useState({ first_name: "", last_name: "", monthly_tuition: "", class_name: "" });
  const [savingChild, setSavingChild] = useState(false);
  const [deletingChild, setDeletingChild] = useState<string | null>(null);

  // Add payment form
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [payForm, setPayForm] = useState({
    amount: "", payment_date: new Date().toISOString().slice(0, 10),
    payment_method: "kas" as PaymentMethod, month: "", year: "", notes: "",
    allocate: true,
  });
  const [savingPayment, setSavingPayment] = useState(false);
  const [deletingPayment, setDeletingPayment] = useState<string | null>(null);

  function loadFamily() {
    return fetch(`/api/families/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setData(d);
        setForm(d.family);
        // Auto-detect next unpaid month
        const paidSet = new Set((d.payments as Payment[]).filter((p) => p.month && p.year).map((p) => `${p.year}-${p.month}`));
        const now = new Date();
        for (const m of ACADEMIC_MONTHS) {
          const y = m >= 9 ? now.getFullYear() : now.getFullYear() + 1;
          if (!paidSet.has(`${y}-${m}`)) {
            setPayForm((prev) => ({ ...prev, month: String(m), year: String(y) }));
            break;
          }
        }
      });
  }

  useEffect(() => {
    loadFamily().finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [key]: e.target.value }));

  async function handleSaveFamily(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/families/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    });
    if (res.ok) { const d = await res.json(); setData((prev) => prev ? { ...prev, family: d.family } : prev); setEditMode(false); }
    else { const d = await res.json(); alert(d.error || "Failed to save"); }
    setSaving(false);
  }

  async function handleAddChild(e: React.FormEvent) {
    e.preventDefault();
    setSavingChild(true);
    const res = await fetch("/api/children", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ family_id: id, ...childForm, monthly_tuition: Number(childForm.monthly_tuition) || 0 }),
    });
    if (res.ok) {
      await loadFamily();
      setChildForm({ first_name: "", last_name: "", monthly_tuition: "", class_name: "" });
      setShowAddChild(false);
    } else { const d = await res.json(); alert(d.error || "Failed to add child"); }
    setSavingChild(false);
  }

  async function handleDeleteChild(childId: string, name: string) {
    if (!confirm(`Remove ${name} from this family?`)) return;
    setDeletingChild(childId);
    const res = await fetch(`/api/children/${childId}`, { method: "DELETE" });
    if (res.ok) setData((prev) => prev ? { ...prev, children: prev.children.filter((c) => c.id !== childId) } : prev);
    else { const d = await res.json(); alert(d.error || "Failed to delete"); }
    setDeletingChild(null);
  }

  async function handleAddPayment(e: React.FormEvent) {
    e.preventDefault();
    setSavingPayment(true);
    const body: Record<string, unknown> = {
      family_id: id, amount: Number(payForm.amount),
      payment_date: payForm.payment_date, payment_method: payForm.payment_method,
      notes: payForm.notes.trim() || null,
    };
    if (payForm.allocate && payForm.month && payForm.year) {
      body.month = Number(payForm.month);
      body.year = Number(payForm.year);
    }
    const res = await fetch("/api/payments", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.ok) {
      await loadFamily();
      setPayForm((p) => ({ ...p, amount: "", notes: "" }));
      setShowAddPayment(false);
    } else { const d = await res.json(); alert(d.error || "Failed to add payment"); }
    setSavingPayment(false);
  }

  async function handleDeletePayment(paymentId: string) {
    if (!confirm("Delete this payment?")) return;
    setDeletingPayment(paymentId);
    const res = await fetch(`/api/payments/${paymentId}`, { method: "DELETE" });
    if (res.ok) {
      setData((prev) => prev ? { ...prev, payments: prev.payments.filter((p) => p.id !== paymentId) } : prev);
    } else { const d = await res.json(); alert(d.error || "Failed to delete"); }
    setDeletingPayment(null);
  }

  const canEdit = user?.is_super_admin;
  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;
  if (!data) return null;

  const { family, children, payments, balance } = data;

  return (
    <div>
      <Header titleKey="page.families" />
      <div className="p-6 space-y-6 max-w-4xl">
        <Link href="/families" className="text-sm text-blue-600 hover:underline block">← Back to families</Link>

        {/* Balance summary */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total Charged", value: balance.charged, color: "text-gray-900" },
            { label: "Total Paid", value: balance.paid, color: "text-green-700" },
            { label: balance.due > 0 ? "Amount Due" : "Credit", value: Math.abs(balance.due), color: balance.due > 0 ? "text-red-600" : "text-green-600" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{formatEur(value)}</p>
            </div>
          ))}
        </div>

        {/* Family info */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">{family.name}</h2>
            {canEdit && !editMode && (
              <button onClick={() => setEditMode(true)} className="text-sm text-blue-600 hover:underline">Edit</button>
            )}
          </div>

          {!editMode ? (
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              {[
                ["Father", family.father_name], ["Mother", family.mother_name],
                ["Phone", family.phone], ["Email", family.email],
                ["Address", family.address], ["City", `${family.city ?? ""} ${family.postal_code ?? ""}`.trim()],
                ["Notes", family.notes],
              ].map(([label, val]) => val ? (
                <div key={label as string}><span className="text-gray-500">{label}:</span> <span className="text-gray-900">{val}</span></div>
              ) : null)}
            </div>
          ) : (
            <form onSubmit={handleSaveFamily} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ["Family Name", "name", "text"], ["Phone", "phone", "tel"],
                  ["Father's Name", "father_name", "text"], ["Email", "email", "email"],
                  ["Mother's Name", "mother_name", "text"], ["Address", "address", "text"],
                  ["City", "city", "text"], ["Postal Code", "postal_code", "text"],
                ].map(([label, key, type]) => (
                  <div key={key as string}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{label as string}</label>
                    <input type={type as string} value={(form[key as keyof Family] as string) ?? ""}
                      onChange={set(key as string)} required={key === "name"}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea value={(form.notes as string) ?? ""} onChange={set("notes")} rows={2}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={saving}
                  className="px-4 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50">
                  {saving ? "Saving…" : "Save"}
                </button>
                <button type="button" onClick={() => { setEditMode(false); setForm(family); }}
                  className="px-4 py-1.5 border border-gray-300 text-gray-700 rounded-md text-sm hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Children */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Children ({children.length})</h2>
            {canEdit && <button onClick={() => setShowAddChild((v) => !v)} className="text-sm text-blue-600 hover:underline">
              {showAddChild ? "Cancel" : "+ Add Child"}
            </button>}
          </div>

          {showAddChild && (
            <form onSubmit={handleAddChild} className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">First Name *</label>
                  <input type="text" value={childForm.first_name} onChange={(e) => setChildForm((p) => ({ ...p, first_name: e.target.value }))} required
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Last Name *</label>
                  <input type="text" value={childForm.last_name} onChange={(e) => setChildForm((p) => ({ ...p, last_name: e.target.value }))} required
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Monthly Tuition (€)</label>
                  <input type="number" value={childForm.monthly_tuition} onChange={(e) => setChildForm((p) => ({ ...p, monthly_tuition: e.target.value }))}
                    min="0" step="0.01" placeholder="0.00"
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Class</label>
                  <input type="text" value={childForm.class_name} onChange={(e) => setChildForm((p) => ({ ...p, class_name: e.target.value }))}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <button type="submit" disabled={savingChild}
                className="px-4 py-1.5 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 disabled:opacity-50">
                {savingChild ? "Adding…" : "Add Child"}
              </button>
            </form>
          )}

          {children.length === 0 && !showAddChild && (
            <p className="text-gray-400 text-sm">No children registered for this family.</p>
          )}

          {children.length > 0 && (
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200">
                <tr>
                  <th className="text-left py-2 font-semibold text-gray-600">Name</th>
                  <th className="text-left py-2 font-semibold text-gray-600">Class</th>
                  <th className="text-right py-2 font-semibold text-gray-600">Monthly Tuition</th>
                  {canEdit && <th className="text-right py-2 font-semibold text-gray-600">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {children.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="py-2 font-medium text-gray-900">{c.first_name} {c.last_name}</td>
                    <td className="py-2 text-gray-600">{c.class_name ?? "—"}</td>
                    <td className="py-2 text-right font-semibold text-gray-900">{formatEur(Number(c.monthly_tuition))}</td>
                    {canEdit && (
                      <td className="py-2 text-right">
                        <button onClick={() => handleDeleteChild(c.id, `${c.first_name} ${c.last_name}`)}
                          disabled={deletingChild === c.id}
                          className="text-red-500 hover:text-red-700 text-xs disabled:opacity-40">
                          {deletingChild === c.id ? "…" : "Remove"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Payments */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Payments ({payments.length})</h2>
            {canEdit && (
              <button onClick={() => setShowAddPayment((v) => !v)} className="text-sm text-blue-600 hover:underline">
                {showAddPayment ? "Cancel" : "+ Add Payment"}
              </button>
            )}
          </div>

          {showAddPayment && (
            <form onSubmit={handleAddPayment} className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Amount (€) *</label>
                  <input type="number" value={payForm.amount} onChange={(e) => setPayForm((p) => ({ ...p, amount: e.target.value }))}
                    min="0.01" step="0.01" required placeholder="0.00"
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
                  <input type="date" value={payForm.payment_date} onChange={(e) => setPayForm((p) => ({ ...p, payment_date: e.target.value }))} required
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Method *</label>
                  <select value={payForm.payment_method} onChange={(e) => setPayForm((p) => ({ ...p, payment_method: e.target.value as PaymentMethod }))}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
                      <option key={m} value={m}>{METHOD_LABELS[m]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                  <input type="text" value={payForm.notes} onChange={(e) => setPayForm((p) => ({ ...p, notes: e.target.value }))}
                    placeholder="Optional note…"
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              {/* Month allocation */}
              <div className="border border-gray-200 rounded-md p-3 space-y-2 bg-white">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={payForm.allocate} onChange={(e) => setPayForm((p) => ({ ...p, allocate: e.target.checked }))}
                    className="w-4 h-4 text-blue-600 rounded" />
                  <span className="text-sm font-medium text-gray-700">Allocate to a specific month</span>
                </label>
                {payForm.allocate && (
                  <div className="grid grid-cols-2 gap-3">
                    <select value={payForm.month} onChange={(e) => setPayForm((p) => ({ ...p, month: e.target.value }))}
                      className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">— Month —</option>
                      {ACADEMIC_MONTHS.map((m) => <option key={m} value={m}>{MONTHS[m]}</option>)}
                    </select>
                    <select value={payForm.year} onChange={(e) => setPayForm((p) => ({ ...p, year: e.target.value }))}
                      className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">— Year —</option>
                      {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                )}
                {payForm.allocate && payForm.month && payForm.year && (
                  <p className="text-xs text-green-700 bg-green-50 rounded px-2 py-1">
                    Allocating to: <strong>{MONTHS[Number(payForm.month)]} {payForm.year}</strong>
                  </p>
                )}
              </div>

              <button type="submit" disabled={savingPayment}
                className="px-4 py-1.5 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 disabled:opacity-50">
                {savingPayment ? "Saving…" : "Save Payment"}
              </button>
            </form>
          )}

          {payments.length === 0 && !showAddPayment && (
            <p className="text-gray-400 text-sm">No payments recorded for this family.</p>
          )}

          {payments.length > 0 && (
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200">
                <tr>
                  <th className="text-left py-2 font-semibold text-gray-600">Date</th>
                  <th className="text-left py-2 font-semibold text-gray-600">Method</th>
                  <th className="text-left py-2 font-semibold text-gray-600">Period</th>
                  <th className="text-left py-2 font-semibold text-gray-600">Notes</th>
                  <th className="text-right py-2 font-semibold text-gray-600">Amount</th>
                  {canEdit && <th className="text-right py-2 font-semibold text-gray-600">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="py-2 text-gray-700">{formatDate(p.payment_date)}</td>
                    <td className="py-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${METHOD_COLORS[p.payment_method]}`}>
                        {METHOD_LABELS[p.payment_method]}
                      </span>
                    </td>
                    <td className="py-2 text-gray-600">
                      {p.month && p.year ? `${MONTHS[p.month]} ${p.year}` : <span className="text-gray-400 italic text-xs">Unallocated</span>}
                    </td>
                    <td className="py-2 text-gray-500 text-xs max-w-xs truncate">{p.notes ?? "—"}</td>
                    <td className="py-2 text-right font-semibold text-gray-900">{formatEur(Number(p.amount))}</td>
                    {canEdit && (
                      <td className="py-2 text-right">
                        <button onClick={() => handleDeletePayment(p.id)} disabled={deletingPayment === p.id}
                          className="text-red-500 hover:text-red-700 text-xs disabled:opacity-40">
                          {deletingPayment === p.id ? "…" : "Delete"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
