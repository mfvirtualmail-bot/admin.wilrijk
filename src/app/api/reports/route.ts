import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { hebrewMonthLabel } from "@/lib/hebrew-date";
import {
  loadTablesForCurrencies,
  fillPaymentEurInMemory,
  fillChargeEurInMemory,
  type PaymentEurRow,
  type ChargeEurRow,
} from "@/lib/fx";
import {
  academicYearMonths,
  currentAcademicYear,
} from "@/lib/academic-year";
import type { Currency } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Reports endpoint. Two complementary views on the same data:
 *
 * 1) Academic-year summary (?year=<hebrewYear>)
 *    Charges + payments inside the selected academic year's Sep→Aug
 *    Gregorian window, broken down by month and method. Defaults to the
 *    current academic year if `year` is omitted.
 *
 * 2) Free date-range collection (?start=YYYY-MM-DD&end=YYYY-MM-DD)
 *    Sum of payments whose payment_date falls in [start, end] inclusive,
 *    in EUR, also broken down by method. When this pair is supplied the
 *    response ALSO includes a `range` block alongside the year summary.
 *    The user explicitly wanted both visible on the same page.
 */

function isoInRange(iso: string, start: string, end: string): boolean {
  if (!iso) return false;
  return iso >= start && iso <= end;
}

export async function GET(req: NextRequest) {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await validateSession(token);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = result.user;
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["reports"]?.includes("view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const yearParam = searchParams.get("year");
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");

  const cur = currentAcademicYear();
  const hebrewYear = yearParam ? Number(yearParam) : cur.hebrewYear;
  const months = academicYearMonths(hebrewYear);
  const minYear = hebrewYear - 3761;
  const maxYear = hebrewYear - 3760;

  const db = createServerClient();

  // Load: charges whose Gregorian (year,month) fall anywhere in the
  // selected academic year's window, + payments both in that window
  // AND (if present) in the supplied date range. We fetch both sets
  // with one query each to keep the endpoint snappy.
  const [familiesRes, paymentsYearRes, chargesRes, paymentsRangeRes] = await Promise.all([
    db.from("families").select("id, name, father_name").order("name"),
    db.from("payments")
      .select("id, family_id, amount, currency, payment_date, payment_method, month, year, eur_amount, eur_rate, eur_rate_date, eur_rate_kind")
      .gte("payment_date", `${minYear}-09-01`)
      .lte("payment_date", `${maxYear}-08-31`),
    db.from("charges")
      .select("id, family_id, amount, currency, month, year, eur_amount, eur_rate, eur_rate_date, eur_rate_kind")
      .gte("year", minYear)
      .lte("year", maxYear),
    startParam && endParam
      ? db.from("payments")
          .select("id, family_id, amount, currency, payment_date, payment_method, eur_amount, eur_rate, eur_rate_date, eur_rate_kind")
          .gte("payment_date", startParam)
          .lte("payment_date", endParam)
      : Promise.resolve({ data: [] as unknown[], error: null as unknown }),
  ]);

  const families = familiesRes.data ?? [];
  const payments = (paymentsYearRes.data ?? []) as Array<PaymentEurRow & {
    family_id: string; payment_method: string; month: number | null; year: number | null;
  }>;
  const charges = (chargesRes.data ?? []) as Array<ChargeEurRow & { family_id: string }>;
  const rangePayments = (paymentsRangeRes.data ?? []) as Array<PaymentEurRow & {
    family_id: string; payment_method: string;
  }>;

  const currencies = new Set<Currency>();
  const collect = (c: Currency | null | undefined) => {
    const cc = (c ?? "EUR") as Currency;
    if (cc === "EUR" || cc === "USD" || cc === "GBP") currencies.add(cc);
  };
  for (const r of payments) collect(r.currency as Currency);
  for (const r of charges) collect(r.currency as Currency);
  for (const r of rangePayments) collect(r.currency as Currency);
  const tables = await loadTablesForCurrencies(db, currencies);
  fillPaymentEurInMemory(payments, tables);
  fillChargeEurInMemory(charges, tables);
  fillPaymentEurInMemory(rangePayments, tables);

  // Only academic-year-appropriate charges: we want charges that belong
  // to this academic year's Gregorian window — drop any stray rows where
  // (year, month) is outside Sep(minYear)→Aug(maxYear).
  const inYearCharges = charges.filter((c) => {
    const m = Number(c.month);
    const y = Number(c.year);
    if (y === minYear) return m >= 9;
    if (y === maxYear) return m <= 8;
    return false;
  });

  // Only count charges whose month has already started — no forward bills.
  const now = new Date();
  const currentKey = now.getFullYear() * 12 + (now.getMonth() + 1);
  const pastCharges = inYearCharges.filter(
    (c) => Number(c.year) * 12 + Number(c.month) <= currentKey,
  );

  const paymentEurById = new Map<string, number>();
  for (const p of payments) paymentEurById.set(p.id, Number(p.eur_amount ?? 0));
  const chargeEurById = new Map<string, number>();
  for (const c of inYearCharges) chargeEurById.set(c.id as string, Number(c.eur_amount ?? 0));

  const chargedByFamily: Record<string, number> = {};
  for (const c of pastCharges) {
    const eur = chargeEurById.get(c.id as string) ?? 0;
    chargedByFamily[c.family_id] = (chargedByFamily[c.family_id] ?? 0) + eur;
  }

  // --- Monthly breakdown for the year (all in EUR). ---
  const expectedByMonth = new Map<string, number>();
  for (const c of inYearCharges) {
    const key = `${c.year}-${c.month}`;
    const eur = chargeEurById.get(c.id as string) ?? 0;
    expectedByMonth.set(key, (expectedByMonth.get(key) ?? 0) + eur);
  }
  const monthlyStats = months.map(({ month, year }) => {
    // Payments: group by calendar month of payment_date (not by the
    // optional month/year hint which doesn't drive allocation).
    const monthPayments = payments.filter((p) => {
      if (!p.payment_date) return false;
      const py = Number(p.payment_date.slice(0, 4));
      const pm = Number(p.payment_date.slice(5, 7));
      return py === year && pm === month;
    });
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

  // --- Payment method breakdown for the year (EUR). ---
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

  // --- Outstanding families for the year. ---
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

  // --- Summary totals for the year. ---
  const totalCharged = pastCharges.reduce(
    (s, c) => s + (chargeEurById.get(c.id as string) ?? 0),
    0,
  );
  const totalPaid = payments.reduce((s, p) => s + Number(p.eur_amount ?? 0), 0);
  const totalDue = Math.max(0, totalCharged - totalPaid);

  // --- Per-currency breakdown for the UI expander. ---
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
    payments: makeSummary(payments),
    charges: makeSummary(inYearCharges),
    paymentsMissing: payments.filter((p) => p.eur_amount == null).length,
    chargesMissing: inYearCharges.filter((c) => c.eur_amount == null).length,
  };

  // --- Free date-range block (only when caller passed start + end). ---
  let range: null | {
    start: string;
    end: string;
    totalPaid: number;
    paidCount: number;
    methodBreakdown: Record<string, { count: number; amount: number }>;
  } = null;
  if (startParam && endParam) {
    const rangeMethodTotals: Record<string, { count: number; amount: number }> = {};
    let rangeTotal = 0;
    let rangeCount = 0;
    for (const p of rangePayments) {
      if (!p.payment_date || !isoInRange(p.payment_date, startParam, endParam)) continue;
      const m = p.payment_method ?? "other";
      const eur = Number(p.eur_amount ?? 0);
      if (!rangeMethodTotals[m]) rangeMethodTotals[m] = { count: 0, amount: 0 };
      rangeMethodTotals[m].count++;
      rangeMethodTotals[m].amount += eur;
      rangeTotal += eur;
      rangeCount++;
    }
    for (const m of Object.keys(rangeMethodTotals)) {
      rangeMethodTotals[m].amount = Math.round(rangeMethodTotals[m].amount * 100) / 100;
    }
    range = {
      start: startParam,
      end: endParam,
      totalPaid: Math.round(rangeTotal * 100) / 100,
      paidCount: rangeCount,
      methodBreakdown: rangeMethodTotals,
    };
  }

  return NextResponse.json({
    hebrewYear,
    academicYear: minYear,
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
    range,
  });
}
