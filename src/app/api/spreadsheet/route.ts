import { NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { hebrewMonthLabel } from "@/lib/hebrew-date";
import { buildFamilyStatement } from "@/lib/statement-data";
import { loadTablesForCurrencies } from "@/lib/fx";
import type { Currency, Family, Child, Charge, Payment } from "@/lib/types";

export const maxDuration = 300;

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

  // Bulk-load ALL data in a handful of queries — one FIFO pass per
  // family runs in memory after this. The per-family-query version
  // timed out Vercel's serverless budget.
  const [familiesRes, childrenRes, chargesRes, paymentsRes] = await Promise.all([
    db.from("families").select("*").eq("is_active", true).order("name"),
    db.from("children").select("*"),
    db.from("charges").select("*"),
    db.from("payments").select("*"),
  ]);

  if (familiesRes.error) return NextResponse.json({ error: familiesRes.error.message }, { status: 500 });

  const families = (familiesRes.data ?? []) as Family[];
  const allChildren = (childrenRes.data ?? []) as Child[];
  const allCharges = (chargesRes.data ?? []) as Charge[];
  const allPayments = (paymentsRes.data ?? []) as Payment[];

  // Shared FX table, built once from every currency referenced anywhere.
  const ccySet = new Set<Currency>();
  ccySet.add("EUR");
  for (const f of families) {
    const c = (f.currency ?? "EUR") as Currency;
    if (c === "EUR" || c === "USD" || c === "GBP") ccySet.add(c);
  }
  for (const c of allChildren) {
    const cur = (c.currency ?? "EUR") as Currency;
    if (cur === "EUR" || cur === "USD" || cur === "GBP") ccySet.add(cur);
  }
  for (const c of allCharges) {
    const cur = (c.currency ?? "EUR") as Currency;
    if (cur === "EUR" || cur === "USD" || cur === "GBP") ccySet.add(cur);
  }
  for (const p of allPayments) {
    const cur = (p.currency ?? "EUR") as Currency;
    if (cur === "EUR" || cur === "USD" || cur === "GBP") ccySet.add(cur);
  }
  const fxTables = await loadTablesForCurrencies(db, ccySet);

  // Index everything by family once so each FIFO pass gets O(1) lookups.
  const childrenByFamily = new Map<string, Child[]>();
  for (const c of allChildren) {
    const bucket = childrenByFamily.get(c.family_id) ?? [];
    bucket.push(c);
    childrenByFamily.set(c.family_id, bucket);
  }
  const chargesByFamily = new Map<string, Charge[]>();
  for (const c of allCharges) {
    const bucket = chargesByFamily.get(c.family_id) ?? [];
    bucket.push(c);
    chargesByFamily.set(c.family_id, bucket);
  }
  const paymentsByFamily = new Map<string, Payment[]>();
  for (const p of allPayments) {
    const bucket = paymentsByFamily.get(p.family_id) ?? [];
    bucket.push(p);
    paymentsByFamily.set(p.family_id, bucket);
  }

  const statements = await Promise.all(
    families.map(async (family) => {
      try {
        return await buildFamilyStatement(db, family.id, new Date(), {
          family,
          children: childrenByFamily.get(family.id) ?? [],
          charges: chargesByFamily.get(family.id) ?? [],
          payments: paymentsByFamily.get(family.id) ?? [],
          fxTables,
        });
      } catch (e) {
        console.error(`spreadsheet: buildFamilyStatement failed for ${family.id}`, e);
        return null;
      }
    })
  );

  const rows = families.map((family, i) => {
    const stmt = statements[i];
    const base: Currency = (stmt?.currency ?? (family.currency ?? "EUR")) as Currency;

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

      // Traffic-light threshold per cell: use the most recent real
      // charge row's totalCharge as the reference "monthly" amount.
      const realTotals = stmt.rows
        .filter((r) => r.kind === "charge" && r.totalCharge > 0)
        .map((r) => r.totalCharge);
      if (realTotals.length > 0) {
        monthlyTuition = realTotals[realTotals.length - 1];
      }

      // Sum every FIFO fragment that landed on each academic-year slot.
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
