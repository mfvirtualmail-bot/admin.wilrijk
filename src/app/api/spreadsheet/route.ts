import { NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { hebrewMonthLabel } from "@/lib/hebrew-date";
import { buildFamilyStatement } from "@/lib/statement-data";
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

  const familiesRes = await db
    .from("families")
    .select("id, name, father_name")
    .eq("is_active", true)
    .order("name");

  if (familiesRes.error) {
    return NextResponse.json({ error: familiesRes.error.message }, { status: 500 });
  }
  const families = familiesRes.data ?? [];

  // Build a full FIFO statement per family so cells match what the
  // statement PDF fills in. This mirrors the allocator used by
  // /api/statements, so paid months appear across the spreadsheet in
  // the same order payments landed — even when a payment has no
  // month/year hint, and even when one payment spans multiple months.
  const statements = await Promise.all(
    families.map((f) => buildFamilyStatement(db, f.id))
  );

  const rows = families.map((family, i) => {
    const stmt = statements[i];
    const base: Currency = (stmt?.currency ?? "EUR") as Currency;

    const monthData: Record<string, {
      paymentId: string | null;
      date: string | null;
      method: string | null;
      amount: number | null;
      currency: Currency | null;
      notes: string | null;
    }> = {};

    for (const { month, year } of months) {
      const monthKey = `m_${month}_${year}`;
      monthData[monthKey] = { paymentId: null, date: null, method: null, amount: null, currency: null, notes: null };
    }

    let monthlyTuition = 0;
    let totalCharged = 0;
    let totalPaid = 0;
    let balance = 0;

    if (stmt) {
      totalCharged = stmt.totalCharged;
      totalPaid = stmt.totalPaid;
      balance = stmt.balanceDue;

      // Approximate "monthly tuition" for cell-colour comparison: take
      // the most common totalCharge across real charge rows, or the
      // last row's total if we only have one. Used only for the
      // paid/partial/unpaid traffic-light background.
      const realTotals = stmt.rows
        .filter((r) => r.kind === "charge" && r.totalCharge > 0)
        .map((r) => r.totalCharge);
      if (realTotals.length > 0) {
        monthlyTuition = realTotals[realTotals.length - 1];
      }

      // Fill each academic-year cell with the sum of FIFO fragments
      // that landed on that Gregorian (month, year). Multiple
      // fragments merge into one cell; a summary note reports how
      // many payments contributed.
      for (const row of stmt.rows) {
        const monthKey = `m_${row.month}_${row.year}`;
        if (!(monthKey in monthData)) continue;
        const frags = row.paymentsApplied;
        if (frags.length === 0) continue;

        const sum = frags.reduce((s, f) => s + f.amount, 0);
        const first = frags[0];
        const methods = new Set(frags.map((f) => f.method));

        monthData[monthKey] = {
          paymentId: frags.length === 1 ? first.paymentId : null,
          date: first.paymentDate,
          method: methods.size === 1 ? first.method : "multi",
          amount: round2(sum),
          currency: base,
          notes: frags.length > 1 ? `${frags.length} payments` : null,
        };
      }
    }

    return {
      familyId: family.id,
      familyName: family.father_name ? `${family.name} (${family.father_name})` : family.name,
      baseCurrency: base,
      monthlyTuition: round2(monthlyTuition),
      totalCharged: round2(totalCharged),
      totalPaid: round2(totalPaid),
      balance: round2(balance),
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
