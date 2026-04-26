import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import {
  loadTablesForCurrencies,
  fillPaymentEurInMemory,
  fillChargeEurInMemory,
  type PaymentEurRow,
  type ChargeEurRow,
} from "@/lib/fx";
import { currentAcademicYear } from "@/lib/academic-year";
import type { Charge, Currency, Payment } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Families list scoped for the past-year payment entry flow on
 * /payments/new. Two scopes:
 *
 *   ?scope=open_balance  (default) — families whose past-years balance
 *      is currently positive. "Past years" = everything before the
 *      current academic year's Sep 1. If the family has been paying in
 *      full this is empty.
 *
 *   ?scope=all — every family ever recorded, active or not. Used when
 *      the operator wants to record a historical payment for a family
 *      that's already settled up.
 *
 * The balance returned is in EUR and is SPECIFICALLY the past-years
 * balance (not lifetime) — so the UI can show "€ 450 still owed from
 * past years" in the dropdown instead of the all-time figure.
 */
export async function GET(req: NextRequest) {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const session = await validateSession(token);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(session.user.id);
  if (!session.user.is_super_admin && !perms["payments"]?.includes("add")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope") === "all" ? "all" : "open_balance";

  const db = createServerClient();
  const [famRes, chargesRes, paymentsRes] = await Promise.all([
    db.from("families").select("id, name, father_name, currency, is_active").order("name"),
    db.from("charges").select("id, family_id, amount, currency, month, year, eur_amount, eur_rate, eur_rate_date, eur_rate_kind"),
    db.from("payments").select("id, family_id, amount, currency, payment_date, eur_amount, eur_rate, eur_rate_date, eur_rate_kind"),
  ]);

  if (famRes.error) return NextResponse.json({ error: famRes.error.message }, { status: 500 });

  const chargeRows = (chargesRes.data ?? []) as Array<ChargeEurRow & Pick<Charge, "family_id" | "month" | "year">>;
  const paymentRows = (paymentsRes.data ?? []) as Array<PaymentEurRow & Pick<Payment, "family_id" | "payment_date">>;

  const ccySet = new Set<Currency>();
  for (const r of chargeRows) {
    const c = (r.currency ?? "EUR") as Currency;
    if (c === "EUR" || c === "USD" || c === "GBP") ccySet.add(c);
  }
  for (const r of paymentRows) {
    const c = (r.currency ?? "EUR") as Currency;
    if (c === "EUR" || c === "USD" || c === "GBP") ccySet.add(c);
  }
  const tables = await loadTablesForCurrencies(db, ccySet);
  fillChargeEurInMemory(chargeRows, tables);
  fillPaymentEurInMemory(paymentRows, tables);

  const cur = currentAcademicYear();
  // Current academic year starts on Sep 1 of this Gregorian year.
  // Anything strictly before that date counts as "past years".
  const cutoffKey = cur.gregStartYear * 12 + 9;

  const pastChargeByFamily = new Map<string, number>();
  for (const c of chargeRows) {
    const key = Number(c.year) * 12 + Number(c.month);
    if (key >= cutoffKey) continue;
    pastChargeByFamily.set(c.family_id, (pastChargeByFamily.get(c.family_id) ?? 0) + Number(c.eur_amount ?? 0));
  }
  const pastPaymentByFamily = new Map<string, number>();
  for (const p of paymentRows) {
    if (!p.payment_date) continue;
    const [yStr, mStr] = p.payment_date.split("-");
    const key = Number(yStr) * 12 + Number(mStr);
    if (key >= cutoffKey) continue;
    pastPaymentByFamily.set(p.family_id, (pastPaymentByFamily.get(p.family_id) ?? 0) + Number(p.eur_amount ?? 0));
  }

  const families = (famRes.data ?? []).map((f) => {
    const charged = pastChargeByFamily.get(f.id as string) ?? 0;
    const paid = pastPaymentByFamily.get(f.id as string) ?? 0;
    const past_balance_eur = Math.round((charged - paid) * 100) / 100;
    return { ...f, past_balance_eur };
  });

  const filtered = scope === "open_balance"
    ? families.filter((f) => f.past_balance_eur > 0)
    : families;

  return NextResponse.json({
    families: filtered,
    scope,
    currentHebrewYear: cur.hebrewYear,
  });
}
