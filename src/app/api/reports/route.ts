import { NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { hebrewMonthLabel } from "@/lib/hebrew-date";
import { convertManyToEur } from "@/lib/fx";
import type { Currency } from "@/lib/types";

const ACADEMIC_MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];

function getAcademicYear(date = new Date()) {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  return month >= 8 ? year : year - 1;
}

function monthYear(baseYear: number, month: number) {
  return { month, year: month >= 9 ? baseYear : baseYear + 1 };
}

export async function GET() {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await validateSession(token);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = result.user;
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["reports"]?.includes("view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const academicYear = getAcademicYear();
  const months = ACADEMIC_MONTHS.map((m) => monthYear(academicYear, m));
  const minYear = academicYear;
  const maxYear = academicYear + 1;

  const [familiesRes, paymentsRes, chargesRes] = await Promise.all([
    db.from("families").select("id, name, father_name").eq("is_active", true).order("name"),
    db.from("payments")
      .select("id, family_id, amount, currency, payment_date, payment_method, month, year")
      .gte("year", minYear)
      .lte("year", maxYear),
    db.from("charges")
      .select("id, family_id, amount, currency, month, year")
      .gte("year", minYear)
      .lte("year", maxYear),
  ]);

  const families = familiesRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const charges = chargesRes.data ?? [];

  // --- Convert every payment and charge to EUR up front. We keep the
  //     per-row EUR amount on the record itself so downstream aggregations
  //     (monthly, per-method, per-family) can just sum the pre-converted
  //     value without each worrying about FX.
  const paymentConv = await convertManyToEur(
    payments.map((p) => ({
      id: p.id as string,
      amount: Number(p.amount),
      currency: ((p.currency as Currency) ?? "EUR") as Currency,
      date: String(p.payment_date).slice(0, 10),
    })),
  );
  const paymentEurById = new Map<string, number>();
  for (const r of paymentConv.breakdown) paymentEurById.set(r.id as string, r.eur);

  const chargeConv = await convertManyToEur(
    charges.map((c) => ({
      id: c.id as string,
      amount: Number(c.amount),
      currency: ((c.currency as Currency) ?? "EUR") as Currency,
      date: `${c.year}-${String(c.month).padStart(2, "0")}-01`,
    })),
  );
  const chargeEurById = new Map<string, number>();
  for (const r of chargeConv.breakdown) chargeEurById.set(r.id as string, r.eur);

  // Only count charges whose month has already started.
  const now = new Date();
  const currentKey = now.getFullYear() * 12 + (now.getMonth() + 1);
  const pastCharges = charges.filter(
    (c) => Number(c.year) * 12 + Number(c.month) <= currentKey,
  );

  const chargedByFamily: Record<string, number> = {};
  for (const c of pastCharges) {
    const eur = chargeEurById.get(c.id as string) ?? 0;
    chargedByFamily[c.family_id] = (chargedByFamily[c.family_id] ?? 0) + eur;
  }

  // --- Monthly breakdown (all in EUR). ---
  const expectedByMonth = new Map<string, number>();
  for (const c of charges) {
    const key = `${c.year}-${c.month}`;
    const eur = chargeEurById.get(c.id as string) ?? 0;
    expectedByMonth.set(key, (expectedByMonth.get(key) ?? 0) + eur);
  }
  const monthlyStats = months.map(({ month, year }) => {
    const monthPayments = payments.filter((p) => p.month === month && p.year === year);
    const collected = monthPayments.reduce(
      (s, p) => s + (paymentEurById.get(p.id as string) ?? 0),
      0,
    );
    const expected = expectedByMonth.get(`${year}-${month}`) ?? 0;
    return {
      month,
      year,
      hebrewLabel: hebrewMonthLabel(month, year),
      collected: Math.round(collected * 100) / 100,
      expected: Math.round(expected * 100) / 100,
      paidCount: monthPayments.length,
      totalFamilies: families.length,
    };
  });

  // --- Payment method breakdown (EUR). ---
  const methodTotals: Record<string, { count: number; amount: number }> = {};
  for (const p of payments) {
    const m = p.payment_method ?? "other";
    if (!methodTotals[m]) methodTotals[m] = { count: 0, amount: 0 };
    methodTotals[m].count++;
    methodTotals[m].amount += paymentEurById.get(p.id as string) ?? 0;
  }
  for (const m of Object.keys(methodTotals)) {
    methodTotals[m].amount = Math.round(methodTotals[m].amount * 100) / 100;
  }

  // --- Outstanding families (EUR). ---
  const paymentsByFamily: Record<string, number> = {};
  for (const p of payments) {
    paymentsByFamily[p.family_id] =
      (paymentsByFamily[p.family_id] ?? 0) + (paymentEurById.get(p.id as string) ?? 0);
  }

  const outstandingFamilies = families
    .map((f) => {
      const charged = chargedByFamily[f.id] ?? 0;
      const paid = paymentsByFamily[f.id] ?? 0;
      const due = charged - paid;
      return {
        id: f.id,
        name: f.father_name ? `${f.name} (${f.father_name})` : f.name,
        charged: Math.round(charged * 100) / 100,
        paid: Math.round(paid * 100) / 100,
        due: Math.round(due * 100) / 100,
      };
    })
    .filter((f) => f.due > 0)
    .sort((a, b) => b.due - a.due);

  // --- Summary totals. ---
  const totalCharged = pastCharges.reduce(
    (s, c) => s + (chargeEurById.get(c.id as string) ?? 0),
    0,
  );
  const totalPaid = paymentConv.totalEur;
  const totalDue = Math.max(0, totalCharged - totalPaid);

  // --- Per-currency breakdown for the UI expander. ---
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
    academicYear,
    summary: {
      totalCharged: Math.round(totalCharged * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalDue: Math.round(totalDue * 100) / 100,
      familyCount: families.length,
    },
    monthlyStats,
    methodBreakdown: methodTotals,
    outstandingFamilies,
    breakdown,
  });
}
