import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import {
  loadTablesForCurrencies,
  fillPaymentEurInMemory,
  fillChargeEurInMemory,
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

  const paymentRows = (paymentsRes.data ?? []) as PaymentEurRow[];
  const tuitionRows = (tuitionRes.data ?? []) as Array<{ monthly_tuition: number; currency: Currency | null }>;

  // Only count charges for months that have already started.
  const now = new Date();
  const currentKey = now.getFullYear() * 12 + (now.getMonth() + 1);
  const chargeRows = ((chargesRes.data ?? []) as ChargeEurRow[])
    .filter((c) => Number(c.year) * 12 + Number(c.month) <= currentKey);

  // Load rate tables ONCE for every currency that appears in the data,
  // then fill `eur_amount` in memory for rows that don't have it. No
  // per-row DB writes — that was the self-heal timeout. The dedicated
  // /api/fx/rebuild-snapshots endpoint does the durable write-back.
  const currencies = new Set<Currency>();
  for (const r of paymentRows) {
    const c = (r.currency ?? "EUR") as Currency;
    if (c === "EUR" || c === "USD" || c === "GBP") currencies.add(c);
  }
  for (const r of chargeRows) {
    const c = (r.currency ?? "EUR") as Currency;
    if (c === "EUR" || c === "USD" || c === "GBP") currencies.add(c);
  }
  for (const t of tuitionRows) {
    const c = (t.currency ?? "EUR") as Currency;
    if (c === "EUR" || c === "USD" || c === "GBP") currencies.add(c);
  }
  const tables = await loadTablesForCurrencies(db, currencies);

  fillPaymentEurInMemory(paymentRows, tables);
  fillChargeEurInMemory(chargeRows, tables);

  const totalPaid = paymentRows.reduce((s, p) => s + Number(p.eur_amount ?? 0), 0);
  const totalCharged = chargeRows.reduce((s, c) => s + Number(c.eur_amount ?? 0), 0);
  const totalDue = Math.max(0, totalCharged - totalPaid);

  // Monthly expected: children's monthly tuition converted at the latest
  // rate we have for each non-EUR currency. (Tuition isn't a charge row,
  // so there's nothing to snapshot.)
  let monthlyExpected = 0;
  for (const t of tuitionRows) {
    const cur = (t.currency ?? "EUR") as Currency;
    const amount = Number(t.monthly_tuition);
    if (cur === "EUR") {
      monthlyExpected += amount;
    } else {
      const table = tables.get(cur);
      const latest = table?.latest;
      if (latest) monthlyExpected += amount / Number(latest.rate);
    }
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
