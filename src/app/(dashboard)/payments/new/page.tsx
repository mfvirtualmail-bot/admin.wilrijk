"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import { CURRENCY_OPTIONS, CURRENCY_SYMBOLS, formatEur } from "@/lib/payment-utils";
import { usePaymentMethods } from "@/lib/use-settings";
import { hebrewMonthLabel } from "@/lib/hebrew-date";
import type { Family, PaymentMethod, Currency } from "@/lib/types";

// Academic year months: Sep → Aug (אלול → אב)
const ACADEMIC_MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];

type Mode = "current" | "past_open" | "past_all";

interface PastFamily extends Family {
  past_balance_eur?: number;
}

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

function NewPaymentForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedFamilyId = searchParams.get("family_id") ?? "";

  const { methodLabels, defaultMethod } = usePaymentMethods();
  const [mode, setMode] = useState<Mode>("current");
  const [families, setFamilies] = useState<Family[]>([]);
  const [pastFamilies, setPastFamilies] = useState<PastFamily[]>([]);
  const [pastScope, setPastScope] = useState<"open_balance" | "all">("open_balance");
  const [loadingPast, setLoadingPast] = useState(false);

  const [familyId, setFamilyId] = useState(preselectedFamilyId);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>("kas");

  useEffect(() => {
    setMethod((m) => (m === "kas" ? defaultMethod : m));
  }, [defaultMethod]);

  const [month, setMonth] = useState<string>("");
  const [year, setYear] = useState<string>("");
  const [allocateMonth, setAllocateMonth] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [autoMonth, setAutoMonth] = useState<{ month: number; year: number } | null>(null);

  useEffect(() => {
    fetch("/api/families")
      .then((r) => r.json())
      .then((d) => setFamilies(d.families ?? []));
  }, []);

  // Past-year scoped list — reload whenever the user flips scope
  // between "families with open past balance" and "all families".
  useEffect(() => {
    if (mode === "current") return;
    setLoadingPast(true);
    fetch(`/api/families/for-past-payment?scope=${pastScope}`)
      .then((r) => r.json())
      .then((d) => setPastFamilies(d.families ?? []))
      .catch(() => setPastFamilies([]))
      .finally(() => setLoadingPast(false));
  }, [mode, pastScope]);

  // When a family is picked in CURRENT mode, auto-detect next unpaid month.
  useEffect(() => {
    if (mode !== "current") { setAutoMonth(null); return; }
    if (!familyId) { setAutoMonth(null); return; }
    fetch(`/api/families/${familyId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.children && d.payments) {
          const next = nextUnpaidMonth([], d.payments);
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
  }, [familyId, mode]);

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
    if (!paymentDate) { setError("Payment date is required."); return; }
    setSaving(true);
    setError("");

    const body: Record<string, unknown> = {
      family_id: familyId,
      amount: Number(amount),
      currency,
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
  const baseYear = new Date().getMonth() + 1 >= 9 ? currentYear : currentYear - 1;
  const monthOptions = ACADEMIC_MONTHS.map((m) => {
    const yr = m >= 9 ? baseYear : baseYear + 1;
    return { month: m, year: yr, label: hebrewMonthLabel(m, yr) };
  });

  // Build the family dropdown options for the currently-chosen mode.
  const activeFamilyOptions = useMemo(() => {
    if (mode === "current") {
      return families.map((f) => ({
        id: f.id,
        label: f.father_name ? `${f.name} (${f.father_name})` : f.name,
        extra: null as string | null,
      }));
    }
    return pastFamilies.map((f) => ({
      id: f.id,
      label: f.father_name ? `${f.name} (${f.father_name})` : f.name,
      extra: (f.past_balance_eur ?? 0) > 0
        ? `past balance: ${formatEur(f.past_balance_eur ?? 0)}`
        : (f.is_active ? null : "inactive"),
    }));
  }, [mode, families, pastFamilies]);

  return (
    <div>
      <Header titleKey="page.payments" />
      <div className="p-6 max-w-xl">
        <Link href="/payments" className="text-sm text-blue-600 hover:underline mb-4 block">← Back to payments</Link>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Record Payment</h2>

          {/* Mode selector */}
          <div className="flex flex-wrap gap-2 mb-4 text-xs">
            <button
              type="button"
              onClick={() => { setMode("current"); setFamilyId(""); }}
              className={`px-3 py-1.5 rounded-md font-medium border transition ${
                mode === "current"
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
            >
              Current payment
            </button>
            <button
              type="button"
              onClick={() => { setMode("past_open"); setPastScope("open_balance"); setFamilyId(""); }}
              className={`px-3 py-1.5 rounded-md font-medium border transition ${
                mode === "past_open"
                  ? "bg-amber-600 text-white border-amber-600"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
            >
              Record payment for previous years
            </button>
            {mode !== "current" && (
              <button
                type="button"
                onClick={() => { setMode("past_all"); setPastScope("all"); setFamilyId(""); }}
                className={`px-3 py-1.5 rounded-md font-medium border transition ${
                  mode === "past_all"
                    ? "bg-gray-700 text-white border-gray-700"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
              >
                Show all families (even with no balance)
              </button>
            )}
          </div>

          {mode !== "current" && (
            <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-md p-3 text-sm">
              {mode === "past_open"
                ? "Showing families with an open balance from previous years. Pick any past payment date."
                : "Showing every family ever recorded, regardless of balance."}
            </div>
          )}

          {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Family */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Family <span className="text-red-500">*</span></label>
              <select
                value={familyId}
                onChange={(e) => setFamilyId(e.target.value)}
                required
                disabled={mode !== "current" && loadingPast}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">— Select family —</option>
                {activeFamilyOptions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}{f.extra ? ` — ${f.extra}` : ""}
                  </option>
                ))}
              </select>
              {mode !== "current" && !loadingPast && activeFamilyOptions.length === 0 && (
                <p className="text-xs text-gray-500 mt-1">No families in this list.</p>
              )}
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
                  min="0.01" step="0.01" required placeholder="0.00"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              </div>
            </div>

            {/* Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Payment Date <span className="text-red-500">*</span>
                {mode !== "current" && (
                  <span className="ml-2 text-xs text-amber-700">Pick the original past date.</span>
                )}
              </label>
              <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            </div>

            {/* Method dropdown */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method <span className="text-red-500">*</span></label>
              <select value={method} onChange={(e) => setMethod(e.target.value)} required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                {Object.keys(methodLabels).map((m) => (
                  <option key={m} value={m}>{methodLabels[m]}</option>
                ))}
              </select>
            </div>

            {/* Month allocation — only meaningful on current-mode (no
                past-years context is typically needed, and the past
                flows record date-based only). */}
            {mode === "current" && (
              <div className="text-xs">
                {!allocateMonth ? (
                  <button
                    type="button"
                    onClick={() => handleAllocateToggle(true)}
                    className="text-blue-600 hover:underline"
                  >
                    + Allocate to a specific month (advanced)
                  </button>
                ) : (
                  <div className="border border-gray-200 rounded-md p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-700">Allocate to month</span>
                      <button
                        type="button"
                        onClick={() => handleAllocateToggle(false)}
                        className="text-gray-500 hover:text-gray-700"
                      >Remove</button>
                    </div>
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
                    {autoMonth && (
                      <p className="text-[11px] text-green-700 bg-green-50 rounded px-2 py-1" dir="rtl">
                        Auto-detected next due month: <strong>{hebrewMonthLabel(autoMonth.month, autoMonth.year)}</strong>
                      </p>
                    )}
                    <p className="text-[11px] text-gray-500">
                      Normally payments just add to the family balance. Use this only when you want to mark a specific month as paid.
                    </p>
                  </div>
                )}
              </div>
            )}

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

export default function NewPaymentPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-500">Loading…</div>}>
      <NewPaymentForm />
    </Suspense>
  );
}
