"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import { CURRENCY_OPTIONS, CURRENCY_SYMBOLS } from "@/lib/payment-utils";
import { usePaymentMethods } from "@/lib/use-settings";
import { hebrewMonthLabel } from "@/lib/hebrew-date";
import type { Family, PaymentMethod, Currency } from "@/lib/types";

const ACADEMIC_MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];

export default function EditPaymentPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const paymentId = params.id;

  const { methodLabels } = usePaymentMethods();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [paymentDate, setPaymentDate] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("kas");
  const [month, setMonth] = useState<string>("");
  const [year, setYear] = useState<string>("");
  const [allocateMonth, setAllocateMonth] = useState(true);
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Load payment + families list in parallel
  useEffect(() => {
    Promise.all([
      fetch(`/api/payments/${paymentId}`).then((r) => r.json()),
      fetch("/api/families").then((r) => r.json()),
    ]).then(([pd, fd]) => {
      if (pd.error || !pd.payment) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const p = pd.payment as {
        family_id: string;
        amount: number;
        currency: Currency;
        payment_date: string;
        payment_method: string;
        month: number | null;
        year: number | null;
        notes: string | null;
      };
      setFamilyId(p.family_id);
      setAmount(String(p.amount));
      setCurrency(p.currency ?? "EUR");
      setPaymentDate(p.payment_date.slice(0, 10));
      setMethod(p.payment_method);
      if (p.month && p.year) {
        setAllocateMonth(true);
        setMonth(String(p.month));
        setYear(String(p.year));
      } else {
        setAllocateMonth(false);
      }
      setNotes(p.notes ?? "");
      setFamilies(fd.families ?? []);
      setLoading(false);
    }).catch(() => {
      setError("Failed to load payment.");
      setLoading(false);
    });
  }, [paymentId]);

  function handleAllocateToggle(val: boolean) {
    setAllocateMonth(val);
    if (!val) {
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
      currency,
      payment_date: paymentDate,
      payment_method: method,
      notes: notes.trim() || null,
      month: allocateMonth && month ? Number(month) : null,
      year: allocateMonth && year ? Number(year) : null,
    };

    const res = await fetch(`/api/payments/${paymentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Failed to save payment"); setSaving(false); return; }
    router.push(`/families/${familyId}`);
  }

  const currentYear = new Date().getFullYear();
  const baseYear = new Date().getMonth() + 1 >= 9 ? currentYear : currentYear - 1;
  // Two academic years of options so past-year payments can stay in range.
  const monthOptions = [baseYear - 1, baseYear].flatMap((b) =>
    ACADEMIC_MONTHS.map((m) => {
      const yr = m >= 9 ? b : b + 1;
      return { month: m, year: yr, label: hebrewMonthLabel(m, yr) };
    }),
  );

  if (loading) {
    return (
      <div>
        <Header titleKey="page.payments" />
        <div className="p-6 max-w-xl text-gray-500 text-sm">Loading payment…</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div>
        <Header titleKey="page.payments" />
        <div className="p-6 max-w-xl">
          <Link href="/payments" className="text-sm text-blue-600 hover:underline">← Back to payments</Link>
          <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-md p-4 text-sm">
            Payment not found.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header titleKey="page.payments" />
      <div className="p-6 max-w-xl">
        <Link href={`/families/${familyId}`} className="text-sm text-blue-600 hover:underline mb-4 block">← Back to family</Link>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-5">Edit Payment</h2>
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
              <p className="text-xs text-gray-500 mt-1">Changing the family reassigns this payment.</p>
            </div>

            {/* Amount + currency */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount ({CURRENCY_SYMBOLS[currency]}) <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}
                  className="w-28 px-2 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                  min="0.01" step="0.01" required
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              </div>
            </div>

            {/* Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date <span className="text-red-500">*</span></label>
              <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            </div>

            {/* Method */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method <span className="text-red-500">*</span></label>
              <select value={method} onChange={(e) => setMethod(e.target.value)} required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                {Object.keys(methodLabels).map((m) => (
                  <option key={m} value={m}>{methodLabels[m]}</option>
                ))}
                {/* If this payment's method code no longer exists in settings,
                    still let the user see/keep it. */}
                {!methodLabels[method] && (
                  <option value={method}>{method} (removed from settings)</option>
                )}
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
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Month</label>
                  <select
                    value={month && year ? `${month}:${year}` : ""}
                    onChange={(e) => {
                      const [m, y] = e.target.value.split(":");
                      setMonth(m ?? "");
                      setYear(y ?? "");
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" dir="rtl">
                    <option value="">— בחר חודש —</option>
                    {monthOptions.map(({ month: m, year: y, label }) => (
                      <option key={`${m}:${y}`} value={`${m}:${y}`}>{label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving}
                className="px-5 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm disabled:opacity-50">
                {saving ? "Saving…" : "Save Changes"}
              </button>
              <Link href={`/families/${familyId}`} className="px-5 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium text-sm">
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
