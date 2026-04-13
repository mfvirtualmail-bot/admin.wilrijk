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

  const [familiesRes, childrenRes, paymentsRes] = await Promise.all([
    db.from("families").select("id, name, father_name").eq("is_active", true).order("name"),
    db.from("children").select("family_id, monthly_tuition").eq("is_active", true),
    db.from("payments")
      .select("id, family_id, amount, payment_date, payment_method, month, year")
      .gte("year", minYear)
      .lte("year", maxYear),
  ]);

  const families = familiesRes.data ?? [];
  const children = childrenRes.data ?? [];
  const payments = paymentsRes.data ?? [];

  // Monthly tuition per family
  const tuitionByFamily: Record<string, number> = {};
  for (const c of children) {
    tuitionByFamily[c.family_id] = (tuitionByFamily[c.family_id] ?? 0) + Number(c.monthly_tuition);
  }

  const totalMonthlyExpected = Object.values(tuitionByFamily).reduce((s, v) => s + v, 0);

  // --- Monthly breakdown ---
  const monthlyStats = months.map(({ month, year }) => {
    const monthPayments = payments.filter((p) => p.month === month && p.year === year);
    const collected = monthPayments.reduce((s, p) => s + Number(p.amount), 0);
    const expected = totalMonthlyExpected;
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
      const tuition = tuitionByFamily[f.id] ?? 0;
      const charged = tuition * months.length;
      const paid = paymentsByFamily[f.id] ?? 0;
      const due = charged - paid;
      return { id: f.id, name: f.father_name ? `${f.name} (${f.father_name})` : f.name, charged, paid, due };
    })
    .filter((f) => f.due > 0)
    .sort((a, b) => b.due - a.due);

  // --- Summary totals ---
  const totalCharged = totalMonthlyExpected * months.length;
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
