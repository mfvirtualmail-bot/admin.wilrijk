import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { hebrewMonthLabelFromHebrew } from "@/lib/hebrew-date";
import { buildFamilyStatement } from "@/lib/statement-data";
import { loadTablesForCurrencies } from "@/lib/fx";
import {
  academicYearMonths,
  currentAcademicYear,
  chargeInAcademicYear,
  familyChargedInYear,
  familyPaidInYear,
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

/** Cell key. Uses Hebrew identity so it matches the canonical
 *  charge key (`hebrew_month`, `hebrew_year`) and never drifts
 *  against the Gregorian Rosh-Chodesh date stored on each row. */
function cellKey(hebrewMonth: number, hebrewYear: number): string {
  return `hk_${hebrewMonth}_${hebrewYear}`;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["spreadsheet"]?.includes("view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();

  const { searchParams } = new URL(req.url);
  const yearParam = searchParams.get("year");
  const includeHidden = searchParams.get("include_hidden") === "1";
  const cur = currentAcademicYear();
  const hebrewYear = yearParam ? Number(yearParam) : cur.hebrewYear;
  const isPastYear = hebrewYear < cur.hebrewYear;

  const months = academicYearMonths(hebrewYear);

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

  const visibleRows = families
    .map((family, i) => {
      const stmt = statements[i];
      const base: Currency = (stmt?.currency ?? (family.currency ?? "EUR")) as Currency;

      const famCharges = chargesByFamily.get(family.id) ?? [];
      const famPayments = paymentsByFamily.get(family.id) ?? [];
      const famChildren = childrenByFamily.get(family.id) ?? [];

      const chargedYear = familyChargedInYear(famCharges, hebrewYear);
      const paidYear = familyPaidInYear(famPayments, hebrewYear);
      const balanceYear = chargedYear - paidYear;

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
        /** Charge owed in this Hebrew month, in family currency. Used to
         *  paint "open" cells for months that have a charge but no
         *  payment yet — without this, an unpaid trailing month rendered
         *  as a blank cell instead of an obvious red one. */
        chargeAmount: number | null;
        /** Remaining residual after FIFO allocation, in family currency.
         *  A cell is "fully paid" iff residual is ~0. */
        residual: number | null;
      }> = {};

      for (const { hebrewMonth, hebrewYear: hy } of months) {
        monthData[cellKey(hebrewMonth, hy)] = {
          paymentId: null, date: null, method: null, amount: null,
          currency: null, notes: null, chargeAmount: null, residual: null,
        };
      }

      let monthlyTuition = 0;

      if (stmt) {
        // Reference "monthly" amount — pulled from this year's charges so
        // past-year spreadsheets don't mis-flag cells against today's
        // tuition. Keys by Hebrew identity, matching the academic-year filter.
        const inYearTotals = stmt.rows
          .filter((r) =>
            r.kind === "charge" &&
            r.totalCharge > 0 &&
            chargeInAcademicYear(r.hebrewMonth, r.hebrewYear, hebrewYear),
          )
          .map((r) => r.totalCharge);
        if (inYearTotals.length > 0) {
          monthlyTuition = inYearTotals[inYearTotals.length - 1];
        } else {
          const realTotals = stmt.rows
            .filter((r) => r.kind === "charge" && r.totalCharge > 0)
            .map((r) => r.totalCharge);
          if (realTotals.length > 0) monthlyTuition = realTotals[realTotals.length - 1];
        }

        for (const row of stmt.rows) {
          const key = cellKey(row.hebrewMonth, row.hebrewYear);
          if (!(key in monthData)) continue;

          const frags = row.paymentsApplied;
          const sum = frags.reduce((s, f) => s + f.amount, 0);
          const first = frags[0];
          const methods = new Set(frags.map((f) => f.method));

          monthData[key] = {
            paymentId: frags.length === 1 ? first.paymentId : null,
            date: first?.paymentDate ?? null,
            method:
              frags.length === 0
                ? null
                : methods.size === 1
                ? first.method
                : "multi",
            amount: frags.length === 0 ? null : round2(sum),
            currency: base,
            notes: frags.length > 1 ? `${frags.length} payments` : null,
            chargeAmount: row.totalCharge > 0 ? round2(row.totalCharge) : null,
            residual: round2(row.residual),
          };
        }
      }

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
      hebrewMonth: m.hebrewMonth,
      hebrewYear: m.hebrewYear,
      // Kept for back-compat with the Excel exporter and any client code
      // that still references {month, year}. These now represent the
      // Gregorian date of Rosh Chodesh, not a civil-month label.
      month: m.gregMonth,
      year: m.gregYear,
      key: cellKey(m.hebrewMonth, m.hebrewYear),
      hebrewLabel: hebrewMonthLabelFromHebrew(m.hebrewMonth, m.hebrewYear),
    })),
  });
}
