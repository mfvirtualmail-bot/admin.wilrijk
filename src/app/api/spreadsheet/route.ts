import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { hebrewMonthLabel } from "@/lib/hebrew-date";
import { buildFamilyStatement } from "@/lib/statement-data";
import { loadTablesForCurrencies } from "@/lib/fx";
import {
  academicYearMonths,
  currentAcademicYear,
  familyChargedInYear,
  familyPaidInYear,
  gregInAcademicYear,
  isChildEnrolledInYear,
  hebrewMonthsBilledInYear,
  isShortStayPaidHidden,
} from "@/lib/academic-year";
import type { Currency, Family, Child, Charge, Payment } from "@/lib/types";

export const maxDuration = 300;

async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const r = await validateSession(token);
  return r?.user ?? null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["spreadsheet"]?.includes("view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();

  // Year + visibility params. Default = current Hebrew academic year,
  // hide short-stay-paid students (user's default-current-year rule).
  const { searchParams } = new URL(req.url);
  const yearParam = searchParams.get("year");
  const includeHidden = searchParams.get("include_hidden") === "1";
  const cur = currentAcademicYear();
  const hebrewYear = yearParam ? Number(yearParam) : cur.hebrewYear;
  const isPastYear = hebrewYear < cur.hebrewYear;

  const months = academicYearMonths(hebrewYear);

  // Bulk-load everything. Same shape as the pre-multi-year implementation
  // — we just filter per-family afterward by academic year instead of
  // showing every family unconditionally.
  const [familiesRes, childrenRes, chargesRes, paymentsRes] = await Promise.all([
    db.from("families").select("*").order("name"),
    db.from("children").select("*"),
    db.from("charges").select("*"),
    db.from("payments").select("*"),
  ]);

  if (familiesRes.error) return NextResponse.json({ error: familiesRes.error.message }, { status: 500 });

  const families = (familiesRes.data ?? []) as Family[];
  const allChildren = (childrenRes.data ?? []) as Child[];
  const allCharges = (chargesRes.data ?? []) as Charge[];
  const allPayments = (paymentsRes.data ?? []) as Payment[];

  const ccySet = new Set<Currency>();
  ccySet.add("EUR");
  for (const f of families) {
    const fc = (f.currency ?? "EUR") as Currency;
    if (fc === "EUR" || fc === "USD" || fc === "GBP") ccySet.add(fc);
  }
  for (const c of allChildren) {
    const cc = (c.currency ?? "EUR") as Currency;
    if (cc === "EUR" || cc === "USD" || cc === "GBP") ccySet.add(cc);
  }
  for (const c of allCharges) {
    const cc = (c.currency ?? "EUR") as Currency;
    if (cc === "EUR" || cc === "USD" || cc === "GBP") ccySet.add(cc);
  }
  for (const p of allPayments) {
    const pc = (p.currency ?? "EUR") as Currency;
    if (pc === "EUR" || pc === "USD" || pc === "GBP") ccySet.add(pc);
  }
  const fxTables = await loadTablesForCurrencies(db, ccySet);

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
  const chargesByChild = new Map<string, Charge[]>();
  for (const c of allCharges) {
    const bucket = chargesByChild.get(c.child_id) ?? [];
    bucket.push(c);
    chargesByChild.set(c.child_id, bucket);
  }
  const paymentsByFamily = new Map<string, Payment[]>();
  for (const p of allPayments) {
    const bucket = paymentsByFamily.get(p.family_id) ?? [];
    bucket.push(p);
    paymentsByFamily.set(p.family_id, bucket);
  }

  // Build statements once per family (same as before — FIFO allocation
  // lives there). We still slice by academic year afterward.
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

  // Filter families to those with at least one child visible for this
  // academic year. The filter uses the charges table for "short-stay
  // paid" detection (Elul+Tishrei only), and the family-level per-year
  // balance to decide whether to hide.
  const visibleRows = families
    .map((family, i) => {
      const stmt = statements[i];
      const base: Currency = (stmt?.currency ?? (family.currency ?? "EUR")) as Currency;

      const famCharges = chargesByFamily.get(family.id) ?? [];
      const famPayments = paymentsByFamily.get(family.id) ?? [];
      const famChildren = childrenByFamily.get(family.id) ?? [];

      // Compute per-year balance once so every per-child visibility
      // check shares the same balance number.
      const chargedYear = familyChargedInYear(famCharges, hebrewYear);
      const paidYear = familyPaidInYear(famPayments, hebrewYear);
      const balanceYear = chargedYear - paidYear;

      // Is any child in this family visible for this year?
      let anyVisible = false;
      for (const ch of famChildren) {
        if (!isChildEnrolledInYear(ch, hebrewYear)) continue;
        if (includeHidden) { anyVisible = true; break; }
        const hebcalMonths = hebrewMonthsBilledInYear(chargesByChild.get(ch.id) ?? [], hebrewYear);
        if (!isShortStayPaidHidden(hebcalMonths, balanceYear)) { anyVisible = true; break; }
      }
      if (!anyVisible) return null;

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

      if (stmt) {
        // Reference "monthly" amount — pulled from this year's charges when
        // possible so past-year spreadsheets don't mis-flag cells against
        // today's tuition.
        const inYearTotals = stmt.rows
          .filter((r) => r.kind === "charge" && r.totalCharge > 0 && gregInAcademicYear(r.month, r.year, hebrewYear))
          .map((r) => r.totalCharge);
        if (inYearTotals.length > 0) {
          monthlyTuition = inYearTotals[inYearTotals.length - 1];
        } else {
          // Fall back to the most recent real charge if nothing in this year.
          const realTotals = stmt.rows
            .filter((r) => r.kind === "charge" && r.totalCharge > 0)
            .map((r) => r.totalCharge);
          if (realTotals.length > 0) monthlyTuition = realTotals[realTotals.length - 1];
        }

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

      // Per-year totals — independent of FIFO, computed from raw charges
      // + payments whose date falls in this year's Gregorian window.
      const totalCharged = chargedYear;
      const totalPaid = paidYear;
      const balance = balanceYear;

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
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return NextResponse.json({
    rows: visibleRows,
    academicYear: cur.gregStartYear,      // kept for back-compat
    hebrewYear,
    isPastYear,
    months: months.map((m) => ({
      ...m,
      key: `m_${m.month}_${m.year}`,
      hebrewLabel: hebrewMonthLabel(m.month, m.year),
    })),
  });
}
