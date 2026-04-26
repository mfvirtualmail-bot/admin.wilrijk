import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { generateChargesForChild } from "@/lib/charge-utils";
import {
  convertManyToEur,
  loadTablesForCurrencies,
  fillPaymentEurInMemory,
  fillChargeEurInMemory,
  type PaymentEurRow,
  type ChargeEurRow,
} from "@/lib/fx";
import {
  familyChargedInYear,
  familyPaidInYear,
  hebrewMonthsBilledInYear,
  isChildEnrolledInYear,
  isShortStayPaidHidden,
} from "@/lib/academic-year";
import type { Child, Charge, Currency, Payment } from "@/lib/types";

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
  if (!user.is_super_admin && !perms["children"]?.includes("view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const familyId = searchParams.get("family_id");
  const yearParam = searchParams.get("year");
  const includeHidden = searchParams.get("include_hidden") === "1";
  const hebrewYear = yearParam ? Number(yearParam) : null;

  const db = createServerClient();
  let query = db
    .from("children")
    .select("*, families(name, father_name)")
    .order("last_name");
  if (familyId) query = query.eq("family_id", familyId);

  const { data: childrenData, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let visibleChildren = (childrenData ?? []) as Array<Child & { families: { name: string; father_name: string | null } | null }>;

  // Per-year filter. Apply only when a year is requested.
  if (hebrewYear != null) {
    const [chargesRes, paymentsRes] = await Promise.all([
      db.from("charges").select("id, family_id, child_id, amount, currency, month, year, hebrew_month, eur_amount, eur_rate, eur_rate_date, eur_rate_kind"),
      db.from("payments").select("id, family_id, amount, currency, payment_date, eur_amount, eur_rate, eur_rate_date, eur_rate_kind"),
    ]);
    const allCharges = (chargesRes.data ?? []) as Array<ChargeEurRow & Pick<Charge, "family_id" | "child_id" | "month" | "year" | "hebrew_month">>;
    const allPayments = (paymentsRes.data ?? []) as Array<PaymentEurRow & Pick<Payment, "family_id" | "payment_date">>;

    const ccySet = new Set<Currency>();
    for (const r of allCharges) {
      const c = (r.currency ?? "EUR") as Currency;
      if (c === "EUR" || c === "USD" || c === "GBP") ccySet.add(c);
    }
    for (const r of allPayments) {
      const c = (r.currency ?? "EUR") as Currency;
      if (c === "EUR" || c === "USD" || c === "GBP") ccySet.add(c);
    }
    const tables = await loadTablesForCurrencies(db, ccySet);
    fillChargeEurInMemory(allCharges, tables);
    fillPaymentEurInMemory(allPayments, tables);

    const chargesByFamily = new Map<string, typeof allCharges>();
    for (const c of allCharges) {
      const b = chargesByFamily.get(c.family_id) ?? [];
      b.push(c);
      chargesByFamily.set(c.family_id, b);
    }
    const chargesByChild = new Map<string, typeof allCharges>();
    for (const c of allCharges) {
      if (!c.child_id) continue;
      const b = chargesByChild.get(c.child_id) ?? [];
      b.push(c);
      chargesByChild.set(c.child_id, b);
    }
    const paymentsByFamily = new Map<string, typeof allPayments>();
    for (const p of allPayments) {
      const b = paymentsByFamily.get(p.family_id) ?? [];
      b.push(p);
      paymentsByFamily.set(p.family_id, b);
    }

    visibleChildren = visibleChildren.filter((ch) => {
      if (!isChildEnrolledInYear(ch, hebrewYear)) return false;
      if (includeHidden) return true;
      const charged = familyChargedInYear(chargesByFamily.get(ch.family_id) ?? [], hebrewYear);
      const paid = familyPaidInYear(paymentsByFamily.get(ch.family_id) ?? [], hebrewYear);
      const months = hebrewMonthsBilledInYear(chargesByChild.get(ch.id) ?? [], hebrewYear);
      return !isShortStayPaidHidden(months, charged - paid);
    });
  }

  // Convert each student's monthly tuition to EUR at today's rate so the
  // page can show a meaningful combined total even when families are
  // billed in different currencies. Only includes active students.
  const today = new Date().toISOString().slice(0, 10);
  const active = visibleChildren.filter((c) => c.is_active);
  const conv = await convertManyToEur(
    active.map((c) => ({
      id: c.id as string,
      amount: Number(c.monthly_tuition),
      currency: ((c.currency as Currency) ?? "EUR") as Currency,
      date: today,
    })),
  );
  type CurSum = { count: number; original: number; eur: number; rates: Set<string> };
  const map = new Map<Currency, CurSum>();
  for (const r of conv.breakdown) {
    const c = r.originalCurrency;
    if (!map.has(c)) map.set(c, { count: 0, original: 0, eur: 0, rates: new Set() });
    const s = map.get(c)!;
    s.count++;
    s.original += r.originalAmount;
    s.eur += r.eur;
    if (c !== "EUR") s.rates.add(r.rate.toFixed(4));
  }
  const breakdown = Array.from(map.entries()).map(([currency, s]) => ({
    currency,
    count: s.count,
    original: Math.round(s.original * 100) / 100,
    eur: Math.round(s.eur * 100) / 100,
    rates: Array.from(s.rates),
  }));

  return NextResponse.json({
    children: visibleChildren,
    summary: {
      totalMonthlyEur: conv.totalEur,
      missing: conv.missing.length,
      breakdown,
    },
  });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["children"]?.includes("add"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const {
    family_id, first_name, last_name, hebrew_name, monthly_tuition, class_name,
    date_of_birth, enrollment_date, notes, currency,
    enrollment_start_month, enrollment_start_year, enrollment_end_month, enrollment_end_year,
  } = body;
  if (!family_id || !first_name?.trim() || !last_name?.trim())
    return NextResponse.json({ error: "family_id, first_name and last_name are required" }, { status: 400 });

  const db = createServerClient();
  const { data, error } = await db
    .from("children")
    .insert({
      family_id, first_name: first_name.trim(), last_name: last_name.trim(),
      hebrew_name: hebrew_name?.trim() || null,
      monthly_tuition: monthly_tuition ?? 0, currency: currency ?? "EUR",
      class_name, date_of_birth, enrollment_date, notes,
      enrollment_start_month: enrollment_start_month ?? null,
      enrollment_start_year: enrollment_start_year ?? null,
      enrollment_end_month: enrollment_end_month ?? null,
      enrollment_end_year: enrollment_end_year ?? null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-generate charges for this child from enrollment_start up to
  // min(enrollment_end, today). Errors are logged but don't fail the
  // student insert — a missing FX rate shouldn't block admin intake.
  if (data && Number(data.monthly_tuition) > 0) {
    try {
      const childCurrency = data.currency ?? "EUR";
      await generateChargesForChild(
        db, data.id, family_id, Number(data.monthly_tuition), childCurrency,
        data.enrollment_start_month, data.enrollment_start_year,
        data.enrollment_end_month, data.enrollment_end_year,
      );
    } catch (e) {
      console.error("[children POST] charge generation failed:", (e as Error).message);
    }
  }

  return NextResponse.json({ child: data }, { status: 201 });
}
