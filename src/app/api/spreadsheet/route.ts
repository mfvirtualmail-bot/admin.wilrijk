import { NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { hebrewMonthLabel, elapsedAcademicMonths } from "@/lib/hebrew-date";

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
    db.from("children")
      .select("family_id, monthly_tuition, enrollment_start_month, enrollment_start_year, enrollment_end_month, enrollment_end_year")
      .eq("is_active", true),
    db.from("payments")
      .select("id, family_id, amount, payment_date, payment_method, month, year, notes")
      .gte("year", minYear)
      .lte("year", maxYear),
  ]);

  if (familiesRes.error) return NextResponse.json({ error: familiesRes.error.message }, { status: 500 });

  const families = familiesRes.data ?? [];
  const children = childrenRes.data ?? [];
  const payments = paymentsRes.data ?? [];

  // How many academic months have already started (as of today, by Hebrew calendar)
  const elapsedMonths = elapsedAcademicMonths(academicYear);

  // Helper: academic-year position (0..11) for a Gregorian month in this year
  const academicIndex = (m: number) => (m >= 9 ? m - 9 : m + 3);

  // For each child, compute academic indexes where they are enrolled.
  // enrollment_end_* being null means "ongoing / no end" (enrolled through end of year).
  function childEnrollmentRange(c: {
    enrollment_start_month: number | null;
    enrollment_start_year: number | null;
    enrollment_end_month: number | null;
    enrollment_end_year: number | null;
  }): { from: number; to: number } {
    const sm = c.enrollment_start_month ?? 9;
    const sy = c.enrollment_start_year ?? academicYear;
    const em = c.enrollment_end_month;
    const ey = c.enrollment_end_year;

    // Convert month+year to an absolute "academic position" that can span years
    const startPos = (sy - academicYear) * 12 + academicIndex(sm);
    const endPos = em != null && ey != null ? (ey - academicYear) * 12 + academicIndex(em) : 11;
    return { from: Math.max(0, startPos), to: Math.min(11, endPos) };
  }

  // Index per-family tuition for each of the 12 academic months, respecting
  // enrollment windows and the elapsed-months cap.
  const familyMonthCharges: Record<string, number[]> = {};
  const studentCountByFamily: Record<string, number> = {};
  for (const fam of families) familyMonthCharges[fam.id] = new Array(12).fill(0);

  for (const c of children) {
    studentCountByFamily[c.family_id] = (studentCountByFamily[c.family_id] ?? 0) + 1;
    const { from, to } = childEnrollmentRange(c);
    const arr = familyMonthCharges[c.family_id];
    if (!arr) continue;
    for (let i = from; i <= to; i++) arr[i] += Number(c.monthly_tuition);
  }

  // tuitionByFamily = current per-month tuition (summed across active children,
  // using their current enrollment window). Used to color cells in the grid.
  const tuitionByFamily: Record<string, number> = {};
  for (const fam of families) {
    // Pick the tuition for the "current" month (last elapsed) as representative,
    // falling back to month 0 if nothing elapsed yet.
    const arr = familyMonthCharges[fam.id];
    const curIdx = Math.max(0, Math.min(11, elapsedMonths - 1));
    tuitionByFamily[fam.id] = arr[curIdx] ?? 0;
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
    const perMonthCharges = familyMonthCharges[family.id] ?? new Array(12).fill(0);
    const monthData: Record<string, {
      paymentId: string | null;
      date: string | null;
      method: string | null;
      amount: number | null;
      notes: string | null;
      charge: number;
      isElapsed: boolean;
    }> = {};

    let totalPaid = 0;
    let totalCharged = 0;

    months.forEach(({ month, year }, idx) => {
      const key = `${family.id}:${month}:${year}`;
      const monthKey = `m_${month}_${year}`;
      const payment = paymentIndex[key] ?? null;

      // Only count as charged if the Hebrew month has already started.
      const isElapsed = idx < elapsedMonths;
      const monthCharge = isElapsed ? perMonthCharges[idx] ?? 0 : 0;

      if (payment) {
        totalPaid += Number(payment.amount);
        monthData[monthKey] = {
          paymentId: payment.id,
          date: payment.payment_date,
          method: payment.payment_method,
          amount: Number(payment.amount),
          notes: payment.notes,
          charge: monthCharge,
          isElapsed,
        };
      } else {
        monthData[monthKey] = {
          paymentId: null, date: null, method: null, amount: null, notes: null,
          charge: monthCharge,
          isElapsed,
        };
      }

      totalCharged += monthCharge;
    });

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
    elapsedMonths,
    months: months.map((m, idx) => ({
      ...m,
      key: `m_${m.month}_${m.year}`,
      hebrewLabel: hebrewMonthLabel(m.month, m.year),
      isElapsed: idx < elapsedMonths,
    })),
  });
}
