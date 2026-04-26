"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import { CURRENCY_OPTIONS, CURRENCY_SYMBOLS, formatCurrency } from "@/lib/payment-utils";
import { hebrewYearToLetters } from "@/lib/hebrew-date";
import { currentAcademicYear } from "@/lib/academic-year";
import type { Currency } from "@/lib/types";

interface ChildOption {
  id: string;
  first_name: string;
  last_name: string;
  family_id: string;
  monthly_tuition: number;
  currency: Currency | null;
  families: { name: string; father_name: string | null } | null;
}

/**
 * Hebrew month picker values in chronological academic order for a given
 * Hebrew year. Academic year starts at Elul of (year-1) and runs through
 * Av of `year`. Leap years add Adar II between Adar and Nisan — easiest
 * to detect by checking whether Adar I / Adar II both exist.
 */
function monthsForAcademicYear(hebrewYear: number): Array<{ hm: number; hy: number; label: string }> {
  // Elul of prior Hebrew year
  const list: Array<{ hm: number; hy: number; label: string }> = [
    { hm: 6, hy: hebrewYear - 1, label: `אלול ${hebrewYearToLetters(hebrewYear - 1)}` },
  ];
  // Tishrei..Av of this year
  // We need to know if `hebrewYear` is a leap year (13 months).
  // Non-leap: 7(Tishrei) 8 9 10 11 12(Adar) 1(Nisan) 2 3 4 5 6(Elul-in-year)-> no, academic ends Av=5.
  // So chronological run: 7,8,9,10,11, 12 (Adar or Adar I), [13 if leap], 1, 2, 3, 4, 5 (Av)
  const MONTH_NAMES: Record<number, string> = {
    1: "ניסן", 2: "אייר", 3: "סיון", 4: "תמוז", 5: "אב", 6: "אלול",
    7: "תשרי", 8: "חשון", 9: "כסלו", 10: "טבת", 11: "שבט",
    12: "אדר", 13: "אדר ב׳",
  };
  // Detect leap year: Hebrew years divisible by 19 in a cycle. Simpler:
  // use hebcal's static: isLeap = (7*year+1) % 19 < 7. That matches
  // HDate.isLeapYear (avoids importing hebcal on client).
  const isLeap = ((7 * hebrewYear + 1) % 19) < 7;

  const yearLabel = hebrewYearToLetters(hebrewYear);
  const sequence = isLeap
    ? [7, 8, 9, 10, 11, 12, 13, 1, 2, 3, 4, 5]
    : [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5];

  for (const m of sequence) {
    const base = MONTH_NAMES[m] ?? `#${m}`;
    const name = isLeap && m === 12 ? "אדר א׳" : base;
    list.push({ hm: m, hy: hebrewYear, label: `${name} ${yearLabel}` });
  }
  return list;
}

function ManualChargeForm() {
  const router = useRouter();
  const search = useSearchParams();
  const preChild = search.get("child_id") ?? "";
  const preYear = search.get("year");

  const [children, setChildren] = useState<ChildOption[]>([]);
  const [childId, setChildId] = useState(preChild);
  const [childSearch, setChildSearch] = useState("");

  const cur = currentAcademicYear();
  const [hebrewYear, setHebrewYear] = useState<number>(preYear ? Number(preYear) : cur.hebrewYear);
  const [hebrewMonth, setHebrewMonth] = useState<number | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Load candidate years (from earliest enrollment back to current). We
  // also fall back to a ±10 window if nothing is known yet.
  const [yearOptions, setYearOptions] = useState<number[]>([]);
  useEffect(() => {
    fetch("/api/academic-years")
      .then((r) => r.json())
      .then((d) => {
        const ys = (d?.years as Array<{ hebrewYear: number }>)?.map((y) => y.hebrewYear) ?? [];
        if (ys.length > 0) {
          // Allow a couple of years back further than the dropdown for
          // the edge case of adding charges for a pre-enrollment window.
          const min = ys[ys.length - 1] - 2;
          const extended: number[] = [];
          for (let y = ys[0]; y >= min; y--) extended.push(y);
          setYearOptions(extended);
        } else {
          const now = cur.hebrewYear;
          setYearOptions(Array.from({ length: 12 }, (_, i) => now - i));
        }
      })
      .catch(() => {
        const now = cur.hebrewYear;
        setYearOptions(Array.from({ length: 12 }, (_, i) => now - i));
      });
  }, [cur.hebrewYear]);

  // Load students
  useEffect(() => {
    fetch("/api/children")
      .then((r) => r.json())
      .then((d) => setChildren((d.children ?? []) as ChildOption[]));
  }, []);

  const filteredChildren = useMemo(() => {
    const q = childSearch.toLowerCase().trim();
    if (!q) return children;
    return children.filter((c) => {
      const famName = c.families?.name?.toLowerCase() ?? "";
      return (
        c.first_name.toLowerCase().includes(q) ||
        c.last_name.toLowerCase().includes(q) ||
        famName.includes(q)
      );
    });
  }, [children, childSearch]);

  const selectedChild = useMemo(
    () => children.find((c) => c.id === childId) ?? null,
    [children, childId],
  );

  // When a student is selected, default the amount and currency from them.
  useEffect(() => {
    if (!selectedChild) return;
    if (!amount) setAmount(String(selectedChild.monthly_tuition ?? ""));
    setCurrency((selectedChild.currency as Currency) ?? "EUR");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChild]);

  const monthOptions = useMemo(() => monthsForAcademicYear(hebrewYear), [hebrewYear]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!childId) { setError("Please pick a student."); return; }
    if (hebrewMonth == null) { setError("Please pick a Hebrew month."); return; }
    const amt = Number(amount);
    if (!isFinite(amt) || amt <= 0) { setError("Amount must be greater than 0."); return; }
    setSaving(true);
    const selected = monthOptions.find((m) => m.hm === hebrewMonth)!;
    const res = await fetch("/api/charges/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        child_id: childId,
        hebrew_month: selected.hm,
        hebrew_year: selected.hy,
        amount: amt,
        currency,
        notes: notes.trim() || null,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Failed to save charge.");
      return;
    }
    setSuccess(`Charge recorded for ${data.hebrewMonth}.`);
    // Clear the month only — keep the student selected so batch
    // entry (Elul, Tishrei, Cheshvan… one click at a time) is fast.
    setHebrewMonth(null);
    setNotes("");
  }

  return (
    <div>
      <Header titleKey="page.payments" />
      <div className="p-6 max-w-2xl">
        <Link href="/children" className="text-sm text-blue-600 hover:underline mb-4 inline-block">← Back</Link>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Record Charge (Historical)</h2>
          <p className="text-sm text-gray-500 mb-5">
            Manually add a tuition charge for a single Hebrew month — use this to seed years where charges weren&apos;t
            auto-generated, or to record a different amount than the student&apos;s current monthly tuition.
          </p>

          {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">{error}</div>}
          {success && <div className="mb-4 bg-green-50 border border-green-200 text-green-700 rounded-md p-3 text-sm">{success}</div>}

          <form onSubmit={onSubmit} className="space-y-4">
            {/* Student picker */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Student <span className="text-red-500">*</span></label>
              <input
                type="text"
                placeholder="Search student or family…"
                value={childSearch}
                onChange={(e) => setChildSearch(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
                required
                size={Math.min(6, Math.max(3, filteredChildren.length))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {filteredChildren.length === 0 && <option value="">No students match.</option>}
                {filteredChildren.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.first_name} {c.last_name} — {c.families?.name ?? ""} ({formatCurrency(Number(c.monthly_tuition), (c.currency as Currency) ?? "EUR")}/mo)
                  </option>
                ))}
              </select>
            </div>

            {/* Year + Month */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hebrew Year <span className="text-red-500">*</span></label>
                <select
                  value={hebrewYear}
                  onChange={(e) => { setHebrewYear(Number(e.target.value)); setHebrewMonth(null); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  dir="rtl"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>{hebrewYearToLetters(y)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hebrew Month <span className="text-red-500">*</span></label>
                <select
                  value={hebrewMonth == null ? "" : String(hebrewMonth)}
                  onChange={(e) => setHebrewMonth(e.target.value ? Number(e.target.value) : null)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  dir="rtl"
                >
                  <option value="">— בחר חודש —</option>
                  {monthOptions.map((m) => (
                    <option key={`${m.hm}-${m.hy}`} value={m.hm}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Amount + currency */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount ({CURRENCY_SYMBOLS[currency]}) <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as Currency)}
                  className="w-28 px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  min="0.01"
                  step="0.01"
                  required
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {selectedChild && (
                <p className="text-[11px] text-gray-500 mt-1">
                  Default is this student&apos;s current monthly tuition. Override if the historical amount was different.
                </p>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Optional — why this historical charge was added"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Charge"}
              </button>
              <button
                type="button"
                onClick={() => router.push("/children")}
                className="px-5 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium text-sm"
              >
                Done
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function ManualChargePage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-500">Loading…</div>}>
      <ManualChargeForm />
    </Suspense>
  );
}
