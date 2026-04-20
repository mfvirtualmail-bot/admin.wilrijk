"use client";

import { useEffect, useRef, useState } from "react";
import { CURRENCY_OPTIONS, CURRENCY_SYMBOLS } from "@/lib/payment-utils";
import { usePaymentMethods } from "@/lib/use-settings";
import { hebrewMonthLabel } from "@/lib/hebrew-date";
import type { Currency, PaymentMethod } from "@/lib/types";

const ACADEMIC_MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];

interface Props {
  familyId: string;
  familyName: string;
  baseCurrency?: Currency;
  onClose: () => void;
  onSaved: () => void;
}

export default function AddPaymentModal({ familyId, familyName, baseCurrency = "EUR", onClose, onSaved }: Props) {
  const { methodLabels, defaultMethod } = usePaymentMethods();
  const amountRef = useRef<HTMLInputElement>(null);

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>(baseCurrency);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>(defaultMethod as PaymentMethod);
  const [notes, setNotes] = useState("");
  const [showAllocate, setShowAllocate] = useState(false);
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMethod((m) => (m === "kas" ? (defaultMethod as PaymentMethod) : m));
  }, [defaultMethod]);

  useEffect(() => {
    amountRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const currentYear = new Date().getFullYear();
  const baseYear = new Date().getMonth() + 1 >= 9 ? currentYear : currentYear - 1;
  const monthOptions = ACADEMIC_MONTHS.map((m) => {
    const yr = m >= 9 ? baseYear : baseYear + 1;
    return { month: m, year: yr, label: hebrewMonthLabel(m, yr) };
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    };
    if (showAllocate && month && year) {
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
    setSaving(false);
    onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500">Add payment for</div>
            <div className="text-sm font-semibold text-gray-800 truncate">{familyName}</div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none px-2"
            aria-label="Close"
          >×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-2 text-sm">{error}</div>}

          {/* Amount — the main focus */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Amount ({CURRENCY_SYMBOLS[currency]}) <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                className="w-24 px-2 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-base"
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <input
                ref={amountRef}
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0.01"
                step="0.01"
                required
                placeholder="0.00"
                className="flex-1 px-3 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-xl font-semibold text-right"
              />
            </div>
          </div>

          {/* Method */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              {Object.keys(methodLabels).map((m) => (
                <option key={m} value={m}>{methodLabels[m]}</option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional…"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>

          {/* Allocate to month — small collapsible link */}
          <div className="text-xs">
            {!showAllocate ? (
              <button
                type="button"
                onClick={() => setShowAllocate(true)}
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
                    onClick={() => { setShowAllocate(false); setMonth(""); setYear(""); }}
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  dir="rtl"
                >
                  <option value="">— בחר חודש —</option>
                  {monthOptions.map(({ month: m, year: y, label }) => (
                    <option key={`${m}:${y}`} value={`${m}:${y}`}>{label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-500">
                  Normally payments just add to the family balance. Use this only when you want to mark a specific month as paid.
                </p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Payment"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
