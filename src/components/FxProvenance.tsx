"use client";

import { useState } from "react";
import { CURRENCY_SYMBOLS, formatEur } from "@/lib/payment-utils";
import type { Currency, FxRateKind } from "@/lib/types";

/** The bits of a payment row this component needs. */
export interface FxSnapshotFields {
  id: string;
  amount: number;
  currency: Currency | string | null;
  eur_amount: number | null;
  eur_rate: number | null;
  eur_rate_date: string | null;
  eur_rate_kind: FxRateKind | string | null;
}

const KIND_LABELS: Record<string, { text: string; cls: string; title: string }> = {
  historical: {
    text: "ECB",
    cls: "bg-green-50 text-green-700 border-green-200",
    title: "Rate published by the ECB on or before the payment date",
  },
  fallback: {
    text: "ECB (fallback)",
    cls: "bg-amber-50 text-amber-800 border-amber-200",
    title:
      "No ECB rate existed for the payment's date — the nearest available rate was used instead",
  },
  manual: {
    text: "Manual",
    cls: "bg-blue-50 text-blue-700 border-blue-200",
    title: "Rate was manually overridden for this specific payment",
  },
};

interface Props {
  payment: FxSnapshotFields;
  canEdit: boolean;
  /** Called with the updated payment row after a successful override. */
  onUpdated?: (updated: unknown) => void;
  /** Layout variant. `inline` = single small line (table rows).
   *  `block` = larger panel (edit page). */
  variant?: "inline" | "block";
}

export default function FxProvenance({ payment, canEdit, onUpdated, variant = "inline" }: Props) {
  const [editing, setEditing] = useState(false);

  const currency = (payment.currency ?? "EUR") as string;
  // Not a foreign currency → nothing to show.
  if (currency === "EUR") return null;

  const sym = CURRENCY_SYMBOLS[currency as Currency] ?? currency;
  const missing = payment.eur_amount == null || payment.eur_rate == null;

  return (
    <>
      {variant === "inline" ? (
        <InlineBadge
          missing={missing}
          eurAmount={payment.eur_amount}
          rate={payment.eur_rate}
          rateDate={payment.eur_rate_date}
          kind={payment.eur_rate_kind as string | null}
          currency={currency}
          canEdit={canEdit}
          onEdit={() => setEditing(true)}
        />
      ) : (
        <BlockPanel
          missing={missing}
          eurAmount={payment.eur_amount}
          rate={payment.eur_rate}
          rateDate={payment.eur_rate_date}
          kind={payment.eur_rate_kind as string | null}
          currency={currency}
          amount={payment.amount}
          sym={sym}
          canEdit={canEdit}
          onEdit={() => setEditing(true)}
        />
      )}

      {editing && (
        <EditRateModal
          payment={payment}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setEditing(false);
            onUpdated?.(updated);
          }}
        />
      )}
    </>
  );
}

function InlineBadge(props: {
  missing: boolean;
  eurAmount: number | null;
  rate: number | null;
  rateDate: string | null;
  kind: string | null;
  currency: string;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const { missing, eurAmount, rate, rateDate, kind, currency, canEdit, onEdit } = props;
  if (missing) {
    return (
      <div className="mt-0.5 flex items-center gap-1 text-[11px] text-red-700">
        <span>⚠ Missing rate</span>
        {canEdit && (
          <button onClick={onEdit} className="underline hover:text-red-900">
            Set rate
          </button>
        )}
      </div>
    );
  }
  const kindLabel = KIND_LABELS[kind ?? "historical"];
  return (
    <div className="mt-0.5 flex items-center flex-wrap gap-1 text-[11px] text-gray-500">
      <span>≈ {formatEur(Number(eurAmount))}</span>
      <span className="text-gray-400">·</span>
      <span title={`1 EUR = ${Number(rate).toFixed(4)} ${currency}`}>
        1€ = {Number(rate).toFixed(4)} {currency}
      </span>
      {kindLabel && (
        <span
          className={`px-1.5 py-[1px] rounded border text-[10px] font-medium ${kindLabel.cls}`}
          title={kindLabel.title}
        >
          {kindLabel.text}
        </span>
      )}
      {rateDate && <span className="text-gray-400">({rateDate})</span>}
      {canEdit && (
        <button onClick={onEdit} className="text-blue-600 hover:underline">
          Edit
        </button>
      )}
    </div>
  );
}

function BlockPanel(props: {
  missing: boolean;
  eurAmount: number | null;
  rate: number | null;
  rateDate: string | null;
  kind: string | null;
  currency: string;
  amount: number;
  sym: string;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const { missing, eurAmount, rate, rateDate, kind, currency, amount, sym, canEdit, onEdit } = props;
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-gray-800">FX conversion</h3>
        {canEdit && (
          <button
            onClick={onEdit}
            className="text-xs text-blue-600 hover:underline font-medium"
          >
            {missing ? "Set rate" : "Override rate"}
          </button>
        )}
      </div>
      {missing ? (
        <p className="text-red-700">
          No exchange rate is stored for this payment. It will not contribute to EUR
          totals until a rate is set.
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
          <div>
            <dt className="text-gray-500 text-xs">Original</dt>
            <dd className="text-gray-900 font-medium">
              {sym}
              {Number(amount).toFixed(2)} {currency}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 text-xs">Converted</dt>
            <dd className="text-gray-900 font-medium">{formatEur(Number(eurAmount))}</dd>
          </div>
          <div>
            <dt className="text-gray-500 text-xs">Rate</dt>
            <dd className="text-gray-900">
              1 EUR = {Number(rate).toFixed(4)} {currency}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 text-xs">Source</dt>
            <dd>
              <KindBadge kind={kind ?? "historical"} />
              {rateDate && <span className="ml-1 text-gray-500 text-xs">({rateDate})</span>}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function KindBadge({ kind }: { kind: string }) {
  const label = KIND_LABELS[kind] ?? KIND_LABELS.historical;
  return (
    <span
      className={`inline-block px-1.5 py-[1px] rounded border text-[11px] font-medium ${label.cls}`}
      title={label.title}
    >
      {label.text}
    </span>
  );
}

function EditRateModal(props: {
  payment: FxSnapshotFields;
  onClose: () => void;
  onSaved: (updated: unknown) => void;
}) {
  const { payment, onClose, onSaved } = props;
  const currency = (payment.currency ?? "EUR") as string;
  const [rate, setRate] = useState(
    payment.eur_rate != null ? String(Number(payment.eur_rate).toFixed(4)) : "",
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const parsed = Number(rate);
  const valid = isFinite(parsed) && parsed > 0;
  const previewEur = valid ? Math.round((Number(payment.amount) / parsed) * 100) / 100 : null;

  async function save() {
    if (!valid) return;
    setSaving(true);
    setErr(null);
    const res = await fetch(`/api/payments/${payment.id}/rate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rate: parsed }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(body.error ?? "Failed to save");
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved(body.payment);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Override FX rate</h3>
        <p className="text-sm text-gray-600 mb-4">
          Sets a manual rate for this payment only. Other payments on the same date
          are unaffected.
        </p>

        <div className="space-y-3">
          <div className="bg-gray-50 rounded p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Payment amount</span>
              <span className="font-medium text-gray-900">
                {Number(payment.amount).toFixed(2)} {currency}
              </span>
            </div>
          </div>

          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">
              Rate (1 EUR = ? {currency})
            </span>
            <input
              type="number"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              step="0.0001"
              min="0.0001"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. 0.8540"
            />
          </label>

          {previewEur != null && (
            <div className="bg-green-50 rounded p-3 text-sm flex justify-between">
              <span className="text-gray-600">Converts to</span>
              <span className="font-semibold text-green-700">{formatEur(previewEur)}</span>
            </div>
          )}

          {err && <div className="text-sm text-red-600">{err}</div>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 border border-gray-300 text-gray-700 rounded-md text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!valid || saving}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save rate"}
          </button>
        </div>
      </div>
    </div>
  );
}
