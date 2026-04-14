import { NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { hebrewMonthLabel } from "@/lib/hebrew-date";

async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const r = await validateSession(token);
  return r?.user ?? null;
}

// Determine the current academic year
// Academic year: Sep (month 9) of year Y → Jul (month 7) of year Y+1
function getAcademicYear(date = new Date()) {
  const month = date.getMonth() + 1; // 1-12
  const year = date.getFullYear();
  return month >= 8 ? year : year - 1; // Aug+ = new year starts
}

const ACADEMIC_MONTHS = [
  { month: 9 }, { month: 10 }, { month: 11 }, { month: 12 },
  { month: 1 }, { month: 2 }, { month: 3 }, { month: 4 },
  { month: 5 }, { month: 6 }, { month: 7 }, { month: 8 },
];

function monthYear(baseYear: number, month: number) {
  return { month, year: month >= 9 ? baseYear : baseYear + 1 };
}

// GET /api/spreadsheet — return all families with monthly payment data
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["spreadsheet"]?.includes("view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const academicYear = getAcademicYear();

  // Build month+year combos for this academic year
  const months = ACADEMIC_MONTHS.map((m) => monthYear(academicYear, m.month));
  const minYear = academicYear;
  const maxYear = academicYear + 1;

  // Load all active families, their children, and relevant payments
  const [familiesRes, childrenRes, paymentsRes] = await Promise.all([
    db.from("families").select("id, name, father_name").eq("is_active", true).order("name"),
    db.from("children").select("family_id, monthly_tuition").eq("is_active", true),
    db.from("payments")
      .select("id, family_id, amount, payment_date, payment_method, month, year, notes")
      .gte("year", minYear)
      .lte("year", maxYear),
  ]);

  if (familiesRes.error) return NextResponse.json({ error: familiesRes.error.message }, { status: 500 });

  const families = familiesRes.data ?? [];
  const children = childrenRes.data ?? [];
  const payments = paymentsRes.data ?? [];

  // Index monthly tuition and student count per family
  const tuitionByFamily: Record<string, number> = {};
  const studentCountByFamily: Record<string, number> = {};
  for (const c of children) {
    tuitionByFamily[c.family_id] = (tuitionByFamily[c.family_id] ?? 0) + Number(c.monthly_tuition);
    studentCountByFamily[c.family_id] = (studentCountByFamily[c.family_id] ?? 0) + 1;
  }
  const totalStudents = children.length;

  // Index payments by family+month+year (take the most recent if multiple)
  const paymentIndex: Record<string, typeof payments[0]> = {};
  for (const p of payments) {
    if (p.month && p.year) {
      const key = `${p.family_id}:${p.month}:${p.year}`;
      paymentIndex[key] = p;
    }
  }

  // Build row data
  const rows = families.map((family) => {
    const monthlyTuition = tuitionByFamily[family.id] ?? 0;
    const studentCount = studentCountByFamily[family.id] ?? 0;
    const monthData: Record<string, {
      paymentId: string | null;
      date: string | null;
      method: string | null;
      amount: number | null;
      notes: string | null;
    }> = {};

    let totalPaid = 0;
    let totalCharged = 0;

    for (const { month, year } of months) {
      const key = `${family.id}:${month}:${year}`;
      const monthKey = `m_${month}_${year}`;
      const payment = paymentIndex[key] ?? null;

      if (payment) {
        totalPaid += Number(payment.amount);
        monthData[monthKey] = {
          paymentId: payment.id,
          date: payment.payment_date,
          method: payment.payment_method,
          amount: Number(payment.amount),
          notes: payment.notes,
        };
      } else {
        monthData[monthKey] = { paymentId: null, date: null, method: null, amount: null, notes: null };
      }

      if (monthlyTuition > 0) totalCharged += monthlyTuition;
    }

    return {
      familyId: family.id,
      familyName: family.father_name ? `${family.name} (${family.father_name})` : family.name,
      monthlyTuition,
      studentCount,
      totalCharged,
      totalPaid,
      balance: totalCharged - totalPaid,
      ...monthData,
    };
  });

  return NextResponse.json({
    rows,
    academicYear,
    totalStudents,
    months: months.map((m) => ({
      ...m,
      key: `m_${m.month}_${m.year}`,
      hebrewLabel: hebrewMonthLabel(m.month, m.year),
    })),
  });
}
