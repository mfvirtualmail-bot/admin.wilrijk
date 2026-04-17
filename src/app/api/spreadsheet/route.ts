import { NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { hebrewMonthLabel } from "@/lib/hebrew-date";
import {
  getRate,
  ensurePaymentEurAmounts,
  ensureChargeEurAmounts,
  type PaymentEurRow,
  type ChargeEurRow,
} from "@/lib/fx";
import type { Currency } from "@/lib/types";

async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const r = await validateSession(token);
  return r?.user ?? null;
}

function getAcademicYear(date = new Date()) {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  return month >= 8 ? year : year - 1;
}

const ACADEMIC_MONTHS = [
  { month: 9 }, { month: 10 }, { month: 11 }, { month: 12 },
  { month: 1 }, { month: 2 }, { month: 3 }, { month: 4 },
  { month: 5 }, { month: 6 }, { month: 7 }, { month: 8 },
];

function monthYear(baseYear: number, month: number) {
  return { month, year: month >= 9 ? baseYear : baseYear + 1 };
}

// Today's rate map (amount of currency per 1 EUR), so summary columns can
// be expressed in each family's base currency. For non-EUR base currencies
// we go EUR -> base by multiplying by the base's rate; for EUR base we
// just sum eur_amount directly.
async function todaysRates() {
  const today = new Date().toISOString().slice(0, 10);
  const rates = new Map<Currency, number>();
  rates.set("EUR", 1);
  for (const c of ["USD", "GBP"] as Currency[]) {
    const r = await getRate(today, c);
    if (r) rates.set(c, r.rate);
  }
  return rates;
}

function eurToBase(eurAmount: number, base: Currency, rates: Map<Currency, number>): number {
  if (base === "EUR") return eurAmount;
  const r = rates.get(base) ?? 1;
  return eurAmount * r;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["spreadsheet"]?.includes("view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const academicYear = getAcademicYear();
  const months = ACADEMIC_MONTHS.map((m) => monthYear(academicYear, m.month));
  const minYear = academicYear;
  const maxYear = academicYear + 1;

  const [familiesRes, childrenRes, paymentsRes, chargesRes] = await Promise.all([
    db.from("families").select("id, name, father_name").eq("is_active", true).order("name"),
    db.from("children").select("family_id, monthly_tuition, currency").eq("is_active", true),
    db.from("payments")
      .select("id, family_id, amount, currency, payment_date, payment_method, month, year, notes, eur_amount, eur_rate, eur_rate_date")
      .gte("year", minYear)
      .lte("year", maxYear),
    db.from("charges")
      .select("id, family_id, amount, currency, month, year, eur_amount, eur_rate, eur_rate_date")
      .gte("year", minYear)
      .lte("year", maxYear),
  ]);

  if (familiesRes.error) return NextResponse.json({ error: familiesRes.error.message }, { status: 500 });

  const families = familiesRes.data ?? [];
  const children = (childrenRes.data ?? []) as Array<{ family_id: string; monthly_tuition: number; currency: Currency | null }>;
  const payments = (paymentsRes.data ?? []) as Array<PaymentEurRow & {
    family_id: string; payment_method: string; month: number | null; year: number | null; notes: string | null;
  }>;
  const charges = (chargesRes.data ?? []) as Array<ChargeEurRow & { family_id: string }>;

  // Self-heal any rows whose snapshot was never written.
  await ensurePaymentEurAmounts(db, payments);
  await ensureChargeEurAmounts(db, charges);

  const rates = await todaysRates();

  // Base currency per family: first non-EUR child tuition currency we
  // see, else EUR. Matches "if tuition is in GBP, totals stay in GBP".
  const baseByFamily = new Map<string, Currency>();
  const childrenByFamily = new Map<string, Array<{ monthly_tuition: number; currency: Currency }>>();
  for (const c of children) {
    const cur: Currency = (c.currency ?? "EUR") as Currency;
    if (!childrenByFamily.has(c.family_id)) childrenByFamily.set(c.family_id, []);
    childrenByFamily.get(c.family_id)!.push({ monthly_tuition: Number(c.monthly_tuition), currency: cur });
    const existing = baseByFamily.get(c.family_id);
    if (!existing) baseByFamily.set(c.family_id, cur);
    else if (existing === "EUR" && cur !== "EUR") baseByFamily.set(c.family_id, cur);
  }

  // Monthly tuition per family in base currency. (Children's tuition
  // doesn't have its own snapshot row, so we convert via EUR at today's
  // rate using a simple two-leg pivot.)
  const tuitionByFamily = new Map<string, number>();
  for (const [famId, kids] of Array.from(childrenByFamily.entries())) {
    const base = baseByFamily.get(famId) ?? "EUR";
    let sum = 0;
    for (const k of kids) {
      const rateFrom = rates.get(k.currency) ?? 1;
      const eur = k.monthly_tuition / rateFrom;
      sum += eurToBase(eur, base, rates);
    }
    tuitionByFamily.set(famId, round2(sum));
  }

  // Charges per (family, month, year) in family's base currency.
  const chargesByFamilyMonth = new Map<string, number>();
  for (const c of charges) {
    const base = baseByFamily.get(c.family_id) ?? "EUR";
    const inBase = eurToBase(Number(c.eur_amount ?? 0), base, rates);
    const key = `${c.family_id}:${c.month}:${c.year}`;
    chargesByFamilyMonth.set(key, (chargesByFamilyMonth.get(key) ?? 0) + inBase);
  }

  // Index payments by (family, month, year). Keep latest if multiple.
  const paymentIndex = new Map<string, (typeof payments)[number]>();
  for (const p of payments) {
    if (p.month && p.year) {
      paymentIndex.set(`${p.family_id}:${p.month}:${p.year}`, p);
    }
  }

  const now = new Date();
  const currentKey = now.getFullYear() * 12 + (now.getMonth() + 1);

  const rows = families.map((family) => {
    const base: Currency = baseByFamily.get(family.id) ?? "EUR";
    const monthlyTuition = tuitionByFamily.get(family.id) ?? 0;

    const monthData: Record<string, {
      paymentId: string | null;
      date: string | null;
      method: string | null;
      amount: number | null;
      currency: Currency | null;
      notes: string | null;
    }> = {};

    let totalPaid = 0;
    let totalCharged = 0;

    for (const { month, year } of months) {
      const key = `${family.id}:${month}:${year}`;
      const monthKey = `m_${month}_${year}`;
      const payment = paymentIndex.get(key) ?? null;

      if (payment) {
        const paidCur: Currency = (payment.currency ?? "EUR") as Currency;
        totalPaid += eurToBase(Number(payment.eur_amount ?? 0), base, rates);
        monthData[monthKey] = {
          paymentId: payment.id,
          date: payment.payment_date,
          method: payment.payment_method,
          amount: Number(payment.amount),
          currency: paidCur,
          notes: payment.notes,
        };
      } else {
        monthData[monthKey] = { paymentId: null, date: null, method: null, amount: null, currency: null, notes: null };
      }

      if (year * 12 + month <= currentKey) {
        totalCharged += chargesByFamilyMonth.get(key) ?? 0;
      }
    }

    return {
      familyId: family.id,
      familyName: family.father_name ? `${family.name} (${family.father_name})` : family.name,
      baseCurrency: base,
      monthlyTuition: round2(monthlyTuition),
      totalCharged: round2(totalCharged),
      totalPaid: round2(totalPaid),
      balance: round2(totalCharged - totalPaid),
      ...monthData,
    };
  });

  return NextResponse.json({
    rows,
    academicYear,
    months: months.map((m) => ({
      ...m,
      key: `m_${m.month}_${m.year}`,
      hebrewLabel: hebrewMonthLabel(m.month, m.year),
    })),
  });
}
