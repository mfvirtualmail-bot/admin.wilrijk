import type { SupabaseClient } from "@supabase/supabase-js";
import type { Family, Child, Charge, Payment, Currency } from "./types";
import { hebrewMonthLabel } from "./hebrew-date";

export interface StatementLine {
  date: string;           // ISO date for sorting
  displayDate: string;    // Hebrew rendered date for the Date column
  label: string;          // description column (child name for charges, תשלום for payments)
  charge: number;         // positive for charges
  payment: number;        // positive for payments
  balance: number;        // running balance (charges - payments)
}

export interface StatementData {
  family: Family;
  children: Child[];
  charges: Charge[];
  payments: Payment[];
  lines: StatementLine[];
  totalCharged: number;
  totalPaid: number;
  balanceDue: number;
  currency: Currency;
  statementDate: string;  // ISO date
}

/**
 * Build an all-time outstanding statement for a family. Combines every charge
 * (per child, per month) and every payment into a single chronologically-sorted
 * ledger with a running balance.
 */
export async function buildFamilyStatement(
  db: SupabaseClient,
  familyId: string,
  statementDate: Date = new Date()
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

  // Only include charges whose month has already started.
  const now = new Date(statementDate);
  const currentKey = now.getFullYear() * 12 + (now.getMonth() + 1);

  const childNameById = new Map<string, string>();
  for (const c of children) {
    const hebrew = c.hebrew_name?.trim() || "";
    const first = c.first_name?.trim() || "";
    const last = c.last_name?.trim() || "";
    const fallback = `${first} ${last}`.trim() || "תלמיד";
    childNameById.set(c.id, hebrew || fallback);
  }

  type Row = { date: string; displayDate: string; label: string; charge: number; payment: number };
  const rows: Row[] = [];

  for (const ch of charges) {
    const key = Number(ch.year) * 12 + Number(ch.month);
    if (key > currentKey) continue;
    // Use 1st of the charge month as the ledger date (for sorting)
    const iso = `${ch.year}-${String(ch.month).padStart(2, "0")}-01`;
    const childName = childNameById.get(ch.child_id) ?? "תלמיד";
    rows.push({
      date: iso,
      displayDate: hebrewMonthLabel(Number(ch.month), Number(ch.year)),
      label: childName,
      charge: Number(ch.amount),
      payment: 0,
    });
  }

  for (const p of payments) {
    // Derive the Hebrew month label from the payment's allocated period if present,
    // otherwise from the payment date itself.
    let pMonth: number;
    let pYear: number;
    if (p.month && p.year) {
      pMonth = Number(p.month);
      pYear = Number(p.year);
    } else {
      const d = new Date(p.payment_date);
      pMonth = d.getMonth() + 1;
      pYear = d.getFullYear();
    }
    rows.push({
      date: p.payment_date,
      displayDate: hebrewMonthLabel(pMonth, pYear),
      label: "תשלום",
      charge: 0,
      payment: Number(p.amount),
    });
  }

  rows.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));

  let running = 0;
  const lines: StatementLine[] = rows.map((r) => {
    running += r.charge - r.payment;
    return { ...r, balance: running };
  });

  const totalCharged = rows.reduce((s, r) => s + r.charge, 0);
  const totalPaid = rows.reduce((s, r) => s + r.payment, 0);

  // Pick currency from the first charge/payment, falling back to EUR.
  const currency: Currency = (charges[0]?.currency ?? payments[0]?.currency ?? "EUR") as Currency;

  return {
    family,
    children,
    charges,
    payments,
    lines,
    totalCharged,
    totalPaid,
    balanceDue: totalCharged - totalPaid,
    currency,
    statementDate: now.toISOString().slice(0, 10),
  };
}

