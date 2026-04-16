"use client";

import { useState } from "react";
import Link from "next/link";
import { formatCurrency, formatEur, CURRENCY_SYMBOLS } from "@/lib/payment-utils";
import type { Currency } from "@/lib/types";

export interface BreakdownRow {
  currency: Currency;
  count: number;
  original: number;
  eur: number;
  rates: string[];
}

interface Props {
  /** e.g. "Payments" — used in the summary text. */
  label: string;
  rows: BreakdownRow[];
  /** Count of items whose rate could not be resolved. */
  missing?: number;
  /** Initially expanded. */
  defaultOpen?: boolean;
}

/**
 * Small accordion component that shows how mixed-currency totals were
 * converted to EUR. Hidden by default to keep the page quiet; expands
 * to reveal per-currency rows like:
 *
 *   GBP: 3 items · £400.00 → €469.68 · rate 1.1742
 *   USD: 1 item · $200.00 → €183.82 · rate 1.0880
 *
 * When rates are missing it links to Advanced Settings where rates
 * can be added manually or refreshed from ECB.
 */
export default function ConversionBreakdown({ label, rows, missing = 0, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  // Only show rows that actually contributed a non-EUR conversion.
  const foreign = rows.filter((r) => r.currency !== "EUR");
  if (foreign.length === 0 && missing === 0) return null;

  return (
    <div className="mt-3 bg-gray-50 border border-gray-200 rounded-md text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-100 rounded-md"
      >
        <span className="font-medium text-gray-700">
          {open ? "▾" : "▸"} {label} conversion breakdown
          {foreign.length > 0 && (
            <span className="ml-2 text-xs text-gray-500">
              ({foreign.reduce((s, r) => s + r.count, 0)} non-EUR items)
            </span>
          )}
          {missing > 0 && (
            <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
              {missing} missing {missing === 1 ? "rate" : "rates"}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-1">
          {foreign.length === 0 ? (
            <div className="text-gray-500 text-xs">All items are in EUR — no conversion needed.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-gray-500">
                <tr>
                  <th className="text-left font-medium py-1">Currency</th>
                  <th className="text-right font-medium py-1">Count</th>
                  <th className="text-right font-medium py-1">Original</th>
                  <th className="text-right font-medium py-1">EUR equivalent</th>
                  <th className="text-right font-medium py-1 whitespace-nowrap">Rate{foreign.some((r) => r.rates.length > 1) ? "s" : ""}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {foreign.map((r) => (
                  <tr key={r.currency}>
                    <td className="py-1 font-medium text-gray-700">
                      {CURRENCY_SYMBOLS[r.currency]} {r.currency}
                    </td>
                    <td className="py-1 text-right text-gray-600">{r.count}</td>
                    <td className="py-1 text-right text-gray-700">{formatCurrency(r.original, r.currency)}</td>
                    <td className="py-1 text-right font-semibold text-gray-900">{formatEur(r.eur)}</td>
                    <td className="py-1 text-right text-gray-500 font-mono">
                      {r.rates.length <= 2 ? r.rates.join(", ") : `${r.rates.length} rates`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {missing > 0 && (
            <div className="mt-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded px-2 py-1.5">
              {missing} {missing === 1 ? "item has" : "items have"} no exchange rate yet and
              could not be added to the EUR total.{" "}
              <Link href="/settings#advanced" className="underline font-medium">
                Add or refresh rates in Advanced Settings
              </Link>
              .
            </div>
          )}
        </div>
      )}
    </div>
  );
}
