import type { SupabaseClient } from "@supabase/supabase-js";
import type { Family, Child, Charge, Payment, Currency } from "./types";

export interface StatementLine {
  date: string;           // ISO date for sorting
  label: string;          // e.g. "Sep 2025 — David (charge)" or "Payment (cash)"
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
    const first = c.first_name?.trim() || "";
    const last = c.last_name?.trim() || "";
    childNameById.set(c.id, `${first} ${last}`.trim() || "Student");
  }

  type Row = { date: string; label: string; charge: number; payment: number };
  const rows: Row[] = [];

  for (const ch of charges) {
    const key = Number(ch.year) * 12 + Number(ch.month);
    if (key > currentKey) continue;
    // Use 1st of the charge month as the ledger date
    const iso = `${ch.year}-${String(ch.month).padStart(2, "0")}-01`;
    const childName = childNameById.get(ch.child_id) ?? "Student";
    rows.push({
      date: iso,
      label: `${monthName(ch.month)} ${ch.year} — ${childName}`,
      charge: Number(ch.amount),
      payment: 0,
    });
  }

  for (const p of payments) {
    rows.push({
      date: p.payment_date,
      label: `Payment (${p.payment_method})`,
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

function monthName(m: number): string {
  return ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m] ?? String(m);
}
