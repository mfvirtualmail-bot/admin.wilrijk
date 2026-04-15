import { NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { hebrewMonthLabel } from "@/lib/hebrew-date";

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
      .select("id, family_id, amount, payment_date, payment_method, month, year")
      .gte("year", minYear)
      .lte("year", maxYear),
    db.from("charges")
      .select("family_id, amount, month, year")
      .gte("year", minYear)
      .lte("year", maxYear),
  ]);

  const families = familiesRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const charges = chargesRes.data ?? [];

  // Only count charges whose month has already started. The charges table
  // already reflects per-child enrollment windows (see generateChargesForChild),
  // so a simple date filter correctly excludes both future months and months
  // where the student wasn't enrolled.
  const now = new Date();
  const currentKey = now.getFullYear() * 12 + (now.getMonth() + 1);
  const pastCharges = charges.filter(
    (c) => Number(c.year) * 12 + Number(c.month) <= currentKey,
  );

  // Charges per family, limited to past/current months.
  const chargedByFamily: Record<string, number> = {};
  for (const c of pastCharges) {
    chargedByFamily[c.family_id] =
      (chargedByFamily[c.family_id] ?? 0) + Number(c.amount);
  }

  // --- Monthly breakdown ---
  // "expected" for a given month is the sum of charges actually generated
  // for that month (respecting enrollment), not a flat "all families × flat
  // tuition" that ignores who was enrolled. For months that haven't started
  // yet we still show the prospective expected amount from charges, so the
  // user can see what will come due.
  const expectedByMonth = new Map<string, number>();
  for (const c of charges) {
    const key = `${c.year}-${c.month}`;
    expectedByMonth.set(key, (expectedByMonth.get(key) ?? 0) + Number(c.amount));
  }
  const monthlyStats = months.map(({ month, year }) => {
    const monthPayments = payments.filter((p) => p.month === month && p.year === year);
    const collected = monthPayments.reduce((s, p) => s + Number(p.amount), 0);
    const expected = expectedByMonth.get(`${year}-${month}`) ?? 0;
    return {
      month,
      year,
      hebrewLabel: hebrewMonthLabel(month, year),
      collected,
      expected,
      paidCount: monthPayments.length,
      totalFamilies: families.length,
    };
  });

  // --- Payment method breakdown ---
  const methodTotals: Record<string, { count: number; amount: number }> = {};
  for (const p of payments) {
    const m = p.payment_method ?? "other";
    if (!methodTotals[m]) methodTotals[m] = { count: 0, amount: 0 };
    methodTotals[m].count++;
    methodTotals[m].amount += Number(p.amount);
  }

  // --- Outstanding families ---
  const paymentsByFamily: Record<string, number> = {};
  for (const p of payments) {
    paymentsByFamily[p.family_id] = (paymentsByFamily[p.family_id] ?? 0) + Number(p.amount);
  }

  const outstandingFamilies = families
    .map((f) => {
      const charged = chargedByFamily[f.id] ?? 0;
      const paid = paymentsByFamily[f.id] ?? 0;
      const due = charged - paid;
      return { id: f.id, name: f.father_name ? `${f.name} (${f.father_name})` : f.name, charged, paid, due };
    })
    .filter((f) => f.due > 0)
    .sort((a, b) => b.due - a.due);

  // --- Summary totals ---
  const totalCharged = pastCharges.reduce((s, c) => s + Number(c.amount), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const totalDue = Math.max(0, totalCharged - totalPaid);

  return NextResponse.json({
    academicYear,
    summary: { totalCharged, totalPaid, totalDue, familyCount: families.length },
    monthlyStats,
    methodBreakdown: methodTotals,
    outstandingFamilies,
  });
}
