import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import {
  ensurePaymentEurAmounts,
  ensureChargeEurAmounts,
  snapshotEurFields,
  type PaymentEurRow,
  type ChargeEurRow,
} from "@/lib/fx";
import type { Currency } from "@/lib/types";

export async function GET() {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await validateSession(token);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServerClient();

  const [familiesRes, childrenRes, paymentsRes, tuitionRes, chargesRes, recentPaymentsRes] = await Promise.all([
    db.from("families").select("id", { count: "exact" }).eq("is_active", true),
    db.from("children").select("id", { count: "exact" }).eq("is_active", true),
    db.from("payments").select("id, amount, currency, payment_date, eur_amount, eur_rate, eur_rate_date, eur_rate_kind"),
    db.from("children").select("monthly_tuition, currency").eq("is_active", true),
    db.from("charges").select("id, amount, currency, month, year, eur_amount, eur_rate, eur_rate_date, eur_rate_kind"),
    db.from("payments")
      .select("id, amount, payment_date, payment_method, currency, families(name, father_name)")
      .order("payment_date", { ascending: false })
      .limit(5),
  ]);

  // Bubble DB errors instead of silently coalescing to [] — the latter
  // pattern hides missing-column / schema-drift problems as "€0 received".
  if (paymentsRes.error || chargesRes.error) {
    const msg = paymentsRes.error?.message ?? chargesRes.error?.message ?? "DB error";
    console.error("[dashboard] supabase error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Self-heal any rows whose EUR snapshot was never written (legacy rows
  // created before migration 004_eur_snapshot). After this call, every
  // row's `eur_amount` is populated both in memory and in the database.
  const paymentRows = (paymentsRes.data ?? []) as PaymentEurRow[];
  await ensurePaymentEurAmounts(db, paymentRows);
  const totalPaid = paymentRows.reduce((s, p) => s + Number(p.eur_amount ?? 0), 0);

  // Only count charges for months that have already started.
  const now = new Date();
  const currentKey = now.getFullYear() * 12 + (now.getMonth() + 1);
  const chargeRows = ((chargesRes.data ?? []) as ChargeEurRow[])
    .filter((c) => Number(c.year) * 12 + Number(c.month) <= currentKey);
  await ensureChargeEurAmounts(db, chargeRows);
  const totalCharged = chargeRows.reduce((s, c) => s + Number(c.eur_amount ?? 0), 0);
  const totalDue = Math.max(0, totalCharged - totalPaid);

  // Monthly expected: tuition rows aren't billed yet (no charge row of
  // their own), so there's nothing to snapshot in the DB. We just
  // convert each child's monthly tuition at today's rate for the stat.
  const tuitionRows = (tuitionRes.data ?? []) as Array<{ monthly_tuition: number; currency: Currency | null }>;
  const today = new Date().toISOString().slice(0, 10);
  let monthlyExpected = 0;
  for (const t of tuitionRows) {
    const eur = await snapshotEurFields(Number(t.monthly_tuition), (t.currency ?? "EUR") as Currency, today);
    if (eur.eur_amount != null) monthlyExpected += eur.eur_amount;
  }

  // Per-currency summary for the UI "breakdown" expander.
  type CurSum = { count: number; original: number; eur: number };
  const makeSummary = (rows: Array<{ amount: number; currency: Currency | null; eur_amount: number | null }>) => {
    const map = new Map<Currency, CurSum>();
    for (const r of rows) {
      const c: Currency = (r.currency ?? "EUR") as Currency;
      if (!map.has(c)) map.set(c, { count: 0, original: 0, eur: 0 });
      const s = map.get(c)!;
      s.count++;
      s.original += Number(r.amount);
      s.eur += Number(r.eur_amount ?? 0);
    }
    return Array.from(map.entries()).map(([currency, s]) => ({
      currency,
      count: s.count,
      original: Math.round(s.original * 100) / 100,
      eur: Math.round(s.eur * 100) / 100,
      rates: [],
    }));
  };

  const breakdown = {
    payments: makeSummary(paymentRows),
    charges: makeSummary(chargeRows),
    paymentsMissing: paymentRows.filter((p) => p.eur_amount == null).length,
    chargesMissing: chargeRows.filter((c) => c.eur_amount == null).length,
  };

  return NextResponse.json({
    stats: {
      families: familiesRes.count ?? 0,
      children: childrenRes.count ?? 0,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalDue: Math.round(totalDue * 100) / 100,
      totalCharged: Math.round(totalCharged * 100) / 100,
      monthlyExpected: Math.round(monthlyExpected * 100) / 100,
    },
    recentPayments: recentPaymentsRes.data ?? [],
    breakdown,
  });
}
