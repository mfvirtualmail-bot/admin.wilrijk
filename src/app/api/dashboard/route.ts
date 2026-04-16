import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { convertManyToEur } from "@/lib/fx";
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
    db.from("payments").select("id, amount, currency, payment_date"),
    db.from("children").select("monthly_tuition, currency").eq("is_active", true),
    db.from("charges").select("id, amount, currency, month, year"),
    db.from("payments")
      .select("id, amount, payment_date, payment_method, currency, families(name, father_name)")
      .order("payment_date", { ascending: false })
      .limit(5),
  ]);

  // Convert every payment to EUR using the rate on its payment_date.
  const paymentRecords = (paymentsRes.data ?? []).map((p) => ({
    id: p.id as string,
    amount: Number(p.amount),
    currency: ((p.currency as Currency) ?? "EUR") as Currency,
    date: String(p.payment_date).slice(0, 10),
  }));
  const paymentConv = await convertManyToEur(paymentRecords);
  const totalPaid = paymentConv.totalEur;

  // Only count charges for months that have already started. Use the first
  // day of the charge's month as the conversion date so GBP/USD charges
  // translate at the rate that applied when they came due.
  const now = new Date();
  const currentKey = now.getFullYear() * 12 + (now.getMonth() + 1);
  const pastCharges = (chargesRes.data ?? []).filter(
    (c) => Number(c.year) * 12 + Number(c.month) <= currentKey,
  );
  const chargeRecords = pastCharges.map((c) => ({
    id: c.id as string,
    amount: Number(c.amount),
    currency: ((c.currency as Currency) ?? "EUR") as Currency,
    date: `${c.year}-${String(c.month).padStart(2, "0")}-01`,
  }));
  const chargeConv = await convertManyToEur(chargeRecords);
  const totalCharged = chargeConv.totalEur;
  const totalDue = Math.max(0, totalCharged - totalPaid);

  // Monthly expected: tuitions have no date, so we convert at today's rate.
  const today = new Date().toISOString().slice(0, 10);
  const tuitionConv = await convertManyToEur(
    (tuitionRes.data ?? []).map((c, i) => ({
      id: `t${i}`,
      amount: Number(c.monthly_tuition),
      currency: ((c.currency as Currency) ?? "EUR") as Currency,
      date: today,
    })),
  );
  const monthlyExpected = tuitionConv.totalEur;

  // Per-currency summary for the UI "breakdown" expander.
  type CurSum = { count: number; original: number; eur: number; rates: Set<string> };
  const makeSummary = (rows: Array<{ originalCurrency: Currency; originalAmount: number; eur: number; rate: number }>) => {
    const map = new Map<Currency, CurSum>();
    for (const r of rows) {
      const c = r.originalCurrency;
      if (!map.has(c)) map.set(c, { count: 0, original: 0, eur: 0, rates: new Set() });
      const s = map.get(c)!;
      s.count++;
      s.original += r.originalAmount;
      s.eur += r.eur;
      if (c !== "EUR") s.rates.add(r.rate.toFixed(4));
    }
    return Array.from(map.entries()).map(([currency, s]) => ({
      currency,
      count: s.count,
      original: Math.round(s.original * 100) / 100,
      eur: Math.round(s.eur * 100) / 100,
      rates: Array.from(s.rates),
    }));
  };

  const breakdown = {
    payments: makeSummary(paymentConv.breakdown),
    charges: makeSummary(chargeConv.breakdown),
    paymentsMissing: paymentConv.missing.length,
    chargesMissing: chargeConv.missing.length,
  };

  return NextResponse.json({
    stats: {
      families: familiesRes.count ?? 0,
      children: childrenRes.count ?? 0,
      totalPaid,
      totalDue,
      totalCharged,
      monthlyExpected,
    },
    recentPayments: recentPaymentsRes.data ?? [],
    breakdown,
  });
}
