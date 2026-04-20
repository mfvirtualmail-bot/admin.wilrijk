import type { SupabaseClient } from "@supabase/supabase-js";
import type { Family, Child, Charge, Payment, Currency } from "./types";
import { hebrewMonthLabel } from "./hebrew-date";
import {
  loadTablesForCurrencies,
  fillChargeEurInMemory,
  fillPaymentEurInMemory,
  convertEurInMemory,
  type ChargeEurRow,
  type PaymentEurRow,
} from "./fx";

/**
 * Bais Rachel-style family statement model.
 *
 * One row per calendar month that has charges. Each month row shows the
 * combined family tuition for that month (with per-child breakdown), plus
 * every payment fragment that FIFO-allocated into that month.
 *
 * Allocation rules (see answers captured in CLAUDE.md session 16):
 *   - Each family has a single `currency`; all amounts in the statement
 *     are expressed in that currency. Charges/payments in another
 *     currency are converted via their stored EUR snapshot at the row's
 *     FX date (first-of-month for charges, payment_date for payments).
 *   - Payments are ordered chronologically by `payment_date`. An
 *     optional `payments.month/year` hint, if set, applies the payment
 *     to that named month FIRST; any overflow rolls FIFO from that
 *     month forward.
 *   - Overpayment (payment totals exceed all real charges) opens
 *     projected future month rows at each active child's current
 *     `monthly_tuition`, up to `min(enrollment_end, +36 months from
 *     statementDate)`. Anything still left over becomes `credit`.
 */

export interface ChildShareItem {
  childId: string;
  name: string;
  /** This child's share of the month's total, in family currency. */
  amount: number;
}

export interface PaymentSubline {
  paymentId: string;
  paymentDate: string;        // ISO YYYY-MM-DD Gregorian
  method: string;             // raw code — UI resolves via payment_method_labels
  reference: string | null;
  /** Amount of this payment fragment applied to THIS month, in family currency. */
  amount: number;
  /** The payment's face value (not necessarily this fragment's slice). */
  originalAmount: number;
  originalCurrency: Currency;
  /** Non-null when the payment's currency differs from family.currency
   *  AND this subline actually converted — UI can show a "£120 (from €144)" badge. */
  fxNote: string | null;
}

export interface StatementMonthRow {
  /** 'charge' = real billed month; 'projected' = synthesized future month
   *  opened because overpayment rolled forward. */
  kind: "charge" | "projected";
  month: number;              // 1..12
  year: number;
  periodLabel: string;        // e.g. "תשרי תשפ״ו"
  /** Combined family charge for this month in family currency. */
  totalCharge: number;
  children: ChildShareItem[];
  paymentsApplied: PaymentSubline[];
  /** Remaining owed for this row. 0 when fully covered, >0 when under-
   *  paid. Never negative — overpayment rolls into later rows. */
  residual: number;
}

export interface StatementData {
  family: Family;
  children: Child[];
  currency: Currency;
  rows: StatementMonthRow[];
  /** Remaining unallocated credit in family currency. >0 when all past +
   *  projected rows are fully paid and there is still payment left. */
  credit: number;
  /** Sum of every row's totalCharge (includes projected rows). */
  totalCharged: number;
  /** Sum of every payment's value in family currency. */
  totalPaid: number;
  /** Σ residuals minus credit. Positive = owed, negative = overpaid. */
  balanceDue: number;
  statementDate: string;      // ISO YYYY-MM-DD
}

/** Max number of future months we will synthesize when overpayment rolls
 *  forward with open-ended enrollment. Guards against a pathologically
 *  large prepayment generating thousands of rows. */
const PROJECTED_HORIZON_MONTHS = 36;

interface PaymentInCcy {
  id: string;
  /** Face amount in family currency (converted from payment.currency if needed). */
  amountFamily: number;
  /** Payment's original face amount. */
  amountOriginal: number;
  originalCurrency: Currency;
  paymentDate: string;        // ISO
  method: string;
  reference: string | null;
  hintKey: number | null;     // year*12+month from payments.month/year, if set
  /** Human note describing the FX conversion, null if no conversion. */
  fxNote: string | null;
}

export async function buildFamilyStatement(
  db: SupabaseClient,
  familyId: string,
  statementDate: Date = new Date(),
): Promise<StatementData | null> {
  const [familyRes, childrenRes, chargesRes, paymentsRes] = await Promise.all([
    db.from("families").select("*").eq("id", familyId).single(),
    db.from("children").select("*").eq("family_id", familyId),
    db.from("charges").select("*").eq("family_id", familyId),
    db.from("payments").select("*").eq("family_id", familyId),
  ]);

  if (familyRes.error || !familyRes.data) return null;

  const family = familyRes.data as Family;
  const children = (childrenRes.data ?? []) as Child[];
  const charges = (chargesRes.data ?? []) as Charge[];
  const payments = (paymentsRes.data ?? []) as Payment[];
  const familyCurrency: Currency = (family.currency ?? "EUR") as Currency;

  const now = new Date(statementDate);
  const currentKey = now.getFullYear() * 12 + (now.getMonth() + 1);

  const childById = new Map<string, Child>();
  for (const c of children) childById.set(c.id, c);

  const childDisplayName = (c: Child | undefined): string => {
    if (!c) return "—";
    const hebrew = c.hebrew_name?.trim() ?? "";
    const fallback = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
    return hebrew || fallback || "תלמיד";
  };

  // ── 1. Load FX tables for every currency involved. We always include
  //    the family currency so we can convert eur_amount → family.currency.
  const ccySet = new Set<Currency>();
  ccySet.add(familyCurrency);
  for (const c of charges) {
    const cc = (c.currency ?? "EUR") as Currency;
    if (cc === "EUR" || cc === "USD" || cc === "GBP") ccySet.add(cc);
  }
  for (const p of payments) {
    const pc = (p.currency ?? "EUR") as Currency;
    if (pc === "EUR" || pc === "USD" || pc === "GBP") ccySet.add(pc);
  }
  const tables = await loadTablesForCurrencies(db, ccySet);

  // Fill missing eur_amount snapshots for all rows (in-memory only).
  const chargeRowsAll = charges as unknown as (Charge & ChargeEurRow)[];
  const paymentRowsAll = payments as unknown as (Payment & PaymentEurRow)[];
  fillChargeEurInMemory(chargeRowsAll, tables);
  fillPaymentEurInMemory(paymentRowsAll, tables);

  // ── 2. Build real month rows, restricted to months already started.
  interface InternalRow extends StatementMonthRow { key: number; }
  const rowByKey = new Map<number, InternalRow>();

  for (const ch of chargeRowsAll) {
    const key = Number(ch.year) * 12 + Number(ch.month);
    if (key > currentKey) continue;
    const fxDate = `${ch.year}-${String(ch.month).padStart(2, "0")}-01`;
    const eur = Number(ch.eur_amount ?? 0);
    const converted = convertEurInMemory(eur, familyCurrency, fxDate, tables);
    const amountFamily = converted ? converted.amount : Number(ch.amount);

    let row = rowByKey.get(key);
    if (!row) {
      row = {
        key,
        kind: "charge",
        month: Number(ch.month),
        year: Number(ch.year),
        periodLabel: hebrewMonthLabel(Number(ch.month), Number(ch.year)),
        totalCharge: 0,
        children: [],
        paymentsApplied: [],
        residual: 0,
      };
      rowByKey.set(key, row);
    }

    row.totalCharge = round2(row.totalCharge + amountFamily);
    row.residual = row.totalCharge; // recomputed after payments

    const child = childById.get(ch.child_id);
    const existingShare = row.children.find((s) => s.childId === ch.child_id);
    if (existingShare) {
      existingShare.amount = round2(existingShare.amount + amountFamily);
    } else {
      row.children.push({
        childId: ch.child_id,
        name: childDisplayName(child),
        amount: round2(amountFamily),
      });
    }
  }

  const rows: InternalRow[] = Array.from(rowByKey.values()).sort((a, b) => a.key - b.key);

  // ── 3. Convert payments into family currency + sort chronologically.
  const paymentsCcy: PaymentInCcy[] = [];
  let totalPaid = 0;

  for (const p of paymentRowsAll) {
    const originalCurrency: Currency = ((p.currency ?? "EUR") as Currency) || "EUR";
    const dateStr = String(p.payment_date).slice(0, 10);
    let amountFamily = Number(p.amount);
    let fxNote: string | null = null;

    if (originalCurrency !== familyCurrency) {
      const eur = Number(p.eur_amount ?? 0);
      const converted = convertEurInMemory(eur, familyCurrency, dateStr, tables);
      if (converted) {
        amountFamily = converted.amount;
        fxNote = `${fmtCcy(Number(p.amount), originalCurrency)} → ${fmtCcy(converted.amount, familyCurrency)}`;
      } else {
        // No rate available — fall back to the EUR snapshot as-is; the UI
        // can flag these rows separately. Better than silently losing the
        // payment from the ledger.
        amountFamily = eur || Number(p.amount);
        fxNote = `${fmtCcy(Number(p.amount), originalCurrency)} (rate unavailable)`;
      }
    }

    totalPaid = round2(totalPaid + amountFamily);
    paymentsCcy.push({
      id: p.id,
      amountFamily: round2(amountFamily),
      amountOriginal: Number(p.amount),
      originalCurrency,
      paymentDate: dateStr,
      method: (p.payment_method ?? "other") as string,
      reference: p.reference ?? null,
      hintKey: p.month != null && p.year != null
        ? Number(p.year) * 12 + Number(p.month)
        : null,
      fxNote,
    });
  }

  // Chronological, with a stable tiebreaker on payment id so the same
  // input always produces the same allocation.
  paymentsCcy.sort((a, b) => {
    if (a.paymentDate !== b.paymentDate) return a.paymentDate < b.paymentDate ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // ── 4. FIFO allocation.
  //
  // For each payment, first try to apply against its hint row (if any);
  // then roll forward from that point to the next row with residual > 0;
  // if everything is covered, open projected rows on the fly.
  //
  // Projected rows use the combined monthly tuition of active children
  // whose enrollment window still covers that month. A month with no
  // contributing children caps the projection — any further overpayment
  // lands in `credit`.

  const projectedCapKey = currentKey + PROJECTED_HORIZON_MONTHS;
  let credit = 0;

  const applyToRow = (row: InternalRow, pay: PaymentInCcy, amount: number) => {
    row.paymentsApplied.push({
      paymentId: pay.id,
      paymentDate: pay.paymentDate,
      method: pay.method,
      reference: pay.reference,
      amount: round2(amount),
      originalAmount: pay.amountOriginal,
      originalCurrency: pay.originalCurrency,
      fxNote: pay.fxNote,
    });
    row.residual = round2(row.residual - amount);
  };

  const ensureProjectedRow = (key: number): InternalRow | null => {
    const existing = rowByKey.get(key);
    if (existing) return existing;
    if (key > projectedCapKey) return null;

    const year = Math.floor((key - 1) / 12);
    const month = ((key - 1) % 12) + 1;
    const dayOne = `${year}-${String(month).padStart(2, "0")}-01`;

    // Which children would be billed for this projected month?
    // Rule: child.is_active = true AND enrollment_end (if set) is on or
    // after this projected month. Uses child.monthly_tuition interpreted
    // in family currency (the new model — see migration 007).
    const contributors: ChildShareItem[] = [];
    let total = 0;
    for (const child of children) {
      if (!child.is_active) continue;
      if (Number(child.monthly_tuition) <= 0) continue;
      if (child.enrollment_end_month != null && child.enrollment_end_year != null) {
        const endKey = Number(child.enrollment_end_year) * 12 + Number(child.enrollment_end_month);
        if (endKey < key) continue;
      }
      // Charges created going forward are in family.currency. Legacy
      // child.currency (pre-migration) might differ; convert via the
      // EUR pivot at the projected month's first day.
      const childCcy = ((child.currency ?? familyCurrency) as Currency);
      let amtFamily = Number(child.monthly_tuition);
      if (childCcy !== familyCurrency) {
        // first convert child.currency → EUR, then EUR → family.currency
        const childTable = tables.get(childCcy);
        const targetTable = tables.get(familyCurrency);
        if (childTable && (targetTable || familyCurrency === "EUR")) {
          // child → EUR
          const picked = pickRateAt(childTable, dayOne);
          if (picked) {
            const eur = amtFamily / picked.rate;
            const converted = convertEurInMemory(eur, familyCurrency, dayOne, tables);
            if (converted) amtFamily = converted.amount;
          }
        }
      }
      amtFamily = round2(amtFamily);
      total = round2(total + amtFamily);
      contributors.push({
        childId: child.id,
        name: childDisplayName(child),
        amount: amtFamily,
      });
    }

    if (total <= 0) return null;

    const row: InternalRow = {
      key,
      kind: "projected",
      month,
      year,
      periodLabel: hebrewMonthLabel(month, year),
      totalCharge: total,
      children: contributors,
      paymentsApplied: [],
      residual: total,
    };
    rowByKey.set(key, row);
    rows.push(row);
    rows.sort((a, b) => a.key - b.key);
    return row;
  };

  for (const pay of paymentsCcy) {
    let remaining = pay.amountFamily;
    if (remaining <= 0) continue;

    // 4a. Apply to hinted row first (if any).
    let cursorKey: number | null = null;
    if (pay.hintKey != null) {
      let hintRow = rowByKey.get(pay.hintKey);
      if (!hintRow) hintRow = ensureProjectedRow(pay.hintKey) ?? undefined;
      if (hintRow && hintRow.residual > 0) {
        const take = Math.min(remaining, hintRow.residual);
        applyToRow(hintRow, pay, take);
        remaining = round2(remaining - take);
      }
      cursorKey = pay.hintKey + 1;
    }

    // 4b. FIFO roll forward (from cursorKey or earliest unfilled row).
    while (remaining > 0) {
      const candidate = findNextUnfilledRow(rows, cursorKey);
      if (candidate) {
        const take = Math.min(remaining, candidate.residual);
        applyToRow(candidate, pay, take);
        remaining = round2(remaining - take);
        cursorKey = candidate.key + 1;
        continue;
      }
      // No unfilled real row left — try to open a projected one.
      const nextKey = nextProjectedKey(rows);
      const proj = ensureProjectedRow(nextKey);
      if (!proj) break; // hit the cap / no active children
      const take = Math.min(remaining, proj.residual);
      applyToRow(proj, pay, take);
      remaining = round2(remaining - take);
      cursorKey = proj.key + 1;
    }

    // 4c. Anything left becomes credit.
    if (remaining > 0) {
      credit = round2(credit + remaining);
    }
  }

  // ── 5. Totals.
  const totalCharged = round2(rows.reduce((s, r) => s + r.totalCharge, 0));
  const residualTotal = round2(rows.reduce((s, r) => s + r.residual, 0));
  const balanceDue = round2(residualTotal - credit);

  const cleanRows: StatementMonthRow[] = rows.map((r) => ({
    kind: r.kind,
    month: r.month,
    year: r.year,
    periodLabel: r.periodLabel,
    totalCharge: r.totalCharge,
    children: r.children,
    paymentsApplied: r.paymentsApplied,
    residual: r.residual,
  }));

  return {
    family,
    children,
    currency: familyCurrency,
    rows: cleanRows,
    credit,
    totalCharged,
    totalPaid,
    balanceDue,
    statementDate: now.toISOString().slice(0, 10),
  };

  // --- helpers scoped to this call ---
  function findNextUnfilledRow(
    list: InternalRow[],
    fromKey: number | null,
  ): InternalRow | null {
    for (const r of list) {
      if (fromKey != null && r.key < fromKey) continue;
      if (r.residual > 1e-9) return r;
    }
    return null;
  }

  function nextProjectedKey(list: InternalRow[]): number {
    const lastKey = list.length > 0 ? list[list.length - 1].key : currentKey - 1;
    return lastKey + 1;
  }
}

/** Binary-search pick: latest row with date ≤ requested date. */
function pickRateAt(
  table: { rows: Array<{ date: string; rate: number }> },
  date: string,
): { rate: number; rateDate: string } | null {
  const { rows } = table;
  if (rows.length === 0) return null;
  let lo = 0, hi = rows.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].date <= date) { found = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  const r = found >= 0 ? rows[found] : rows[0];
  return { rate: Number(r.rate), rateDate: r.date };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

function fmtCcy(n: number, c: Currency): string {
  const sym = c === "EUR" ? "€" : c === "USD" ? "$" : c === "GBP" ? "£" : "";
  return `${sym}${n.toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
