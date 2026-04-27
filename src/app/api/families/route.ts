import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";

// Route is auth-guarded with cookies() and computes fresh balances;
// make sure Next.js never serves a cached response.
export const dynamic = "force-dynamic";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import {
  loadTablesForCurrencies,
  fillPaymentEurInMemory,
  fillChargeEurInMemory,
  type PaymentEurRow,
  type ChargeEurRow,
} from "@/lib/fx";
import {
  currentAcademicYear,
  familyChargedInYear,
  familyPaidInYear,
  hebrewMonthsBilledInYear,
  isChildEnrolledInYear,
  isShortStayPaidHidden,
} from "@/lib/academic-year";
import type { Currency, Charge, Child, Payment } from "@/lib/types";

async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const r = await validateSession(token);
  return r?.user ?? null;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["families"]?.includes("view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();

  // Optional per-year filter. When omitted, behaves like the original
  // all-time endpoint. When provided, balance_eur reflects only that
  // year's charges minus payments, and families are filtered to those
  // with at least one child visible for the year.
  const { searchParams } = new URL(req.url);
  const yearParam = searchParams.get("year");
  const includeHidden = searchParams.get("include_hidden") === "1";
  const openBalanceOnly = searchParams.get("open_balance") === "1";
  const hebrewYear = yearParam ? Number(yearParam) : null;
  const cur = currentAcademicYear();

  const [famRes, chargesRes, paymentsRes, childrenRes] = await Promise.all([
    db.from("families").select("*").order("name"),
    db.from("charges").select("id, family_id, child_id, amount, currency, month, year, hebrew_month, hebrew_year, eur_amount, eur_rate, eur_rate_date, eur_rate_kind"),
    db.from("payments").select("id, family_id, amount, currency, payment_date, eur_amount, eur_rate, eur_rate_date, eur_rate_kind"),
    db.from("children").select("id, family_id, enrollment_start_month, enrollment_start_year, enrollment_end_month, enrollment_end_year, is_active"),
  ]);
  if (famRes.error) return NextResponse.json({ error: famRes.error.message }, { status: 500 });

  const chargeRowsAll = (chargesRes.data ?? []) as Array<ChargeEurRow & Pick<Charge, "family_id" | "child_id" | "month" | "year" | "hebrew_month" | "hebrew_year">>;
  const paymentRowsAll = (paymentsRes.data ?? []) as Array<PaymentEurRow & Pick<Payment, "family_id" | "payment_date">>;
  const children = (childrenRes.data ?? []) as Array<Pick<Child, "id" | "family_id" | "enrollment_start_month" | "enrollment_start_year" | "enrollment_end_month" | "enrollment_end_year" | "is_active">>;

  const currencies = new Set<Currency>();
  for (const r of paymentRowsAll) {
    const c = (r.currency ?? "EUR") as Currency;
    if (c === "EUR" || c === "USD" || c === "GBP") currencies.add(c);
  }
  for (const r of chargeRowsAll) {
    const c = (r.currency ?? "EUR") as Currency;
    if (c === "EUR" || c === "USD" || c === "GBP") currencies.add(c);
  }
  const tables = await loadTablesForCurrencies(db, currencies);
  fillChargeEurInMemory(chargeRowsAll, tables);
  fillPaymentEurInMemory(paymentRowsAll, tables);

  const childrenByFamily = new Map<string, typeof children>();
  for (const c of children) {
    const bucket = childrenByFamily.get(c.family_id) ?? [];
    bucket.push(c);
    childrenByFamily.set(c.family_id, bucket);
  }
  const chargesByFamily = new Map<string, typeof chargeRowsAll>();
  for (const c of chargeRowsAll) {
    const bucket = chargesByFamily.get(c.family_id) ?? [];
    bucket.push(c);
    chargesByFamily.set(c.family_id, bucket);
  }
  const chargesByChild = new Map<string, typeof chargeRowsAll>();
  for (const c of chargeRowsAll) {
    if (!c.child_id) continue;
    const bucket = chargesByChild.get(c.child_id) ?? [];
    bucket.push(c);
    chargesByChild.set(c.child_id, bucket);
  }
  const paymentsByFamily = new Map<string, typeof paymentRowsAll>();
  for (const p of paymentRowsAll) {
    const bucket = paymentsByFamily.get(p.family_id) ?? [];
    bucket.push(p);
    paymentsByFamily.set(p.family_id, bucket);
  }

  // Now-cap for charges: don't count a month that hasn't started yet.
  const now = new Date();
  const currentKey = now.getFullYear() * 12 + (now.getMonth() + 1);

  const families = (famRes.data ?? [])
    .map((f) => {
      const famCharges = chargesByFamily.get(f.id as string) ?? [];
      const famPayments = paymentsByFamily.get(f.id as string) ?? [];
      const famChildren = childrenByFamily.get(f.id as string) ?? [];

      let charged = 0;
      let paid = 0;

      if (hebrewYear != null) {
        // Per-year balance: charges for year Y, payments dated in year Y.
        charged = familyChargedInYear(famCharges, hebrewYear);
        paid = familyPaidInYear(famPayments, hebrewYear);
      } else {
        // Lifetime balance (legacy behaviour). Charges only count if
        // their month has started.
        for (const c of famCharges) {
          if (Number(c.year) * 12 + Number(c.month) > currentKey) continue;
          charged += Number(c.eur_amount ?? 0);
        }
        for (const p of famPayments) {
          paid += Number(p.eur_amount ?? 0);
        }
      }
      const balance_eur = Math.max(0, Math.round((charged - paid) * 100) / 100);

      // Per-year visibility filter.
      if (hebrewYear != null) {
        const balanceForRule = charged - paid;
        let anyVisible = false;
        for (const ch of famChildren) {
          if (!isChildEnrolledInYear(ch, hebrewYear)) continue;
          if (includeHidden) { anyVisible = true; break; }
          const months = hebrewMonthsBilledInYear(chargesByChild.get(ch.id) ?? [], hebrewYear);
          if (!isShortStayPaidHidden(months, balanceForRule)) { anyVisible = true; break; }
        }
        if (!anyVisible) return null;
      }

      return { ...f, balance_eur };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .filter((f) => !openBalanceOnly || (f.balance_eur ?? 0) > 0);

  return NextResponse.json({
    families,
    hebrewYear,
    isPastYear: hebrewYear != null && hebrewYear < cur.hebrewYear,
  });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["families"]?.includes("add"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { name, father_name, mother_name, address, city, postal_code, phone, email, notes, language, currency } = body;
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const validLang = language === "yi" || language === "en" ? language : "en";
  const validCurrency: Currency =
    currency === "USD" || currency === "GBP" || currency === "EUR" ? currency : "EUR";

  const db = createServerClient();
  const { data, error } = await db
    .from("families")
    .insert({
      name: name.trim(),
      father_name,
      mother_name,
      address,
      city,
      postal_code,
      phone,
      email,
      notes,
      language: validLang,
      currency: validCurrency,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ family: data }, { status: 201 });
}
