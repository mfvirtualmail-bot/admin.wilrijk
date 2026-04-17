import { NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { hebrewMonthLabel } from "@/lib/hebrew-date";
import {
  ensurePaymentEurAmounts,
  ensureChargeEurAmounts,
  selectWithEurFallback,
  type PaymentEurRow,
  type ChargeEurRow,
} from "@/lib/fx";
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

  const [familiesRes, payments, charges] = await Promise.all([
    db.from("families").select("id, name, father_name").eq("is_active", true).order("name"),
    selectWithEurFallback<PaymentEurRow & {
      family_id: string; payment_method: string; month: number | null; year: number | null;
    }>(
      (cols) => db.from("payments").select(cols).gte("year", minYear).lte("year", maxYear),
      "id, family_id, amount, currency, payment_date, payment_method, month, year",
      "payments",
    ),
    selectWithEurFallback<ChargeEurRow & { family_id: string }>(
      (cols) => db.from("charges").select(cols).gte("year", minYear).lte("year", maxYear),
      "id, family_id, amount, currency, month, year",
      "charges",
    ),
  ]);

  const families = familiesRes.data ?? [];

  await ensurePaymentEurAmounts(db, payments);
  await ensureChargeEurAmounts(db, charges);

  const paymentEurById = new Map<string, number>();
  for (const p of payments) paymentEurById.set(p.id, Number(p.eur_amount ?? 0));
  const chargeEurById = new Map<string, number>();
  for (const c of charges) chargeEurById.set(c.id, Number(c.eur_amount ?? 0));

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
  const totalPaid = payments.reduce((s, p) => s + Number(p.eur_amount ?? 0), 0);
  const totalDue = Math.max(0, totalCharged - totalPaid);

  // --- Per-currency breakdown for the UI expander. Uses the snapshot
  // values stored on each row, so it never reports any rows as "missing"
  // (the snapshot's most-recent-rate fallback handles that case at write
  // time, and self-heal handles legacy rows on read).
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
    charges: makeSummary(charges),
    paymentsMissing: payments.filter((p) => p.eur_amount == null).length,
    chargesMissing: charges.filter((c) => c.eur_amount == null).length,
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
