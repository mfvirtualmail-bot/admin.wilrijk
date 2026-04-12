"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import { METHOD_LABELS, MONTHS } from "@/lib/payment-utils";
import type { Family, PaymentMethod } from "@/lib/types";

// Academic year months in order: Sep→Oct→Nov→Dec→Jan→Feb→Mar→Apr→May→Jun→Jul
const ACADEMIC_MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7];

function nextUnpaidMonth(charges: { month: number; year: number }[], payments: { month: number | null; year: number | null }[]) {
  const paidSet = new Set(payments.filter((p) => p.month && p.year).map((p) => `${p.year}-${p.month}`));
  for (const m of ACADEMIC_MONTHS) {
    const year = m >= 9 ? new Date().getFullYear() : new Date().getFullYear() + 1;
    if (!paidSet.has(`${year}-${m}`)) {
      const hasCharge = charges.some((c) => c.month === m && c.year === year);
      if (hasCharge) return { month: m, year };
    }
  }
  return null;
}

export default function NewPaymentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedFamilyId = searchParams.get("family_id") ?? "";

  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState(preselectedFamilyId);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>("kas");
  const [month, setMonth] = useState<string>("");
  const [year, setYear] = useState<string>("");
  const [allocateMonth, setAllocateMonth] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [autoMonth, setAutoMonth] = useState<{ month: number; year: number } | null>(null);

  // Load families list
  useEffect(() => {
    fetch("/api/families")
      .then((r) => r.json())
      .then((d) => setFamilies(d.families ?? []));
  }, []);

  // When family changes, auto-detect next unpaid month
  useEffect(() => {
    if (!familyId) { setAutoMonth(null); return; }
    fetch(`/api/families/${familyId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.children && d.payments) {
          const next = nextUnpaidMonth([], d.payments);
          // Fallback: use current academic month
          const now = new Date();
          const cm = now.getMonth() + 1;
          const cy = now.getFullYear();
          const detected = next ?? { month: cm, year: cy };
          setAutoMonth(detected);
          if (allocateMonth) {
            setMonth(String(detected.month));
            setYear(String(detected.year));
          }
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId]);

  function handleAllocateToggle(val: boolean) {
    setAllocateMonth(val);
    if (val && autoMonth) {
      setMonth(String(autoMonth.month));
      setYear(String(autoMonth.year));
    } else if (!val) {
      setMonth("");
      setYear("");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!familyId) { setError("Please select a family."); return; }
    if (!amount || Number(amount) <= 0) { setError("Amount must be greater than 0."); return; }
    setSaving(true);
    setError("");

    const body: Record<string, unknown> = {
      family_id: familyId,
      amount: Number(amount),
      payment_date: paymentDate,
      payment_method: method,
      notes: notes.trim() || null,
    };
    if (allocateMonth && month && year) {
      body.month = Number(month);
      body.year = Number(year);
    }

    const res = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Failed to save payment"); setSaving(false); return; }
    router.push(familyId ? `/families/${familyId}` : "/payments");
  }

  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <div>
      <Header titleKey="page.payments" />
      <div className="p-6 max-w-xl">
        <Link href="/payments" className="text-sm text-blue-600 hover:underline mb-4 block">← Back to payments</Link>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-5">Record Payment</h2>
          {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Family */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Family <span className="text-red-500">*</span></label>
              <select value={familyId} onChange={(e) => setFamilyId(e.target.value)} required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                <option value="">— Select family —</option>
                {families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>

            {/* Amount */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (€) <span className="text-red-500">*</span></label>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                min="0.01" step="0.01" required placeholder="0.00"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            </div>

            {/* Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date <span className="text-red-500">*</span></label>
              <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            </div>

            {/* Method dropdown */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method <span className="text-red-500">*</span></label>
              <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
                  <option key={m} value={m}>{METHOD_LABELS[m]}</option>
                ))}
              </select>
            </div>

            {/* Month allocation */}
            <div className="border border-gray-200 rounded-md p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Allocate to a month?</span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={allocateMonth} onChange={(e) => handleAllocateToggle(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded" />
                  <span className="text-sm text-gray-600">Yes, allocate to month</span>
                </label>
              </div>

              {allocateMonth && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Month</label>
                    <select value={month} onChange={(e) => setMonth(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                      <option value="">— Month —</option>
                      {ACADEMIC_MONTHS.map((m) => (
                        <option key={m} value={m}>{MONTHS[m]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Year</label>
                    <select value={year} onChange={(e) => setYear(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                      <option value="">— Year —</option>
                      {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {!allocateMonth && (
                <p className="text-xs text-gray-500 italic">
                  Payment will be recorded without a specific month. You can allocate it later.
                </p>
              )}

              {autoMonth && allocateMonth && (
                <p className="text-xs text-green-700 bg-green-50 rounded px-2 py-1">
                  Auto-detected next due month: <strong>{MONTHS[autoMonth.month]} {autoMonth.year}</strong>
                </p>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                placeholder="Optional note about this payment…"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving}
                className="px-5 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm disabled:opacity-50">
                {saving ? "Saving…" : "Save Payment"}
              </button>
              <Link href="/payments" className="px-5 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium text-sm">
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
