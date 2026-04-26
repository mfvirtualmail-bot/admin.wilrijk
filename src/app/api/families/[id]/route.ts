import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import {
  loadTablesForCurrencies,
  fillPaymentEurInMemory,
  fillChargeEurInMemory,
  type PaymentEurRow,
  type ChargeEurRow,
} from "@/lib/fx";
import type { Currency } from "@/lib/types";

async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const r = await validateSession(token);
  return r?.user ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["families"]?.includes("view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const [familyRes, childrenRes, paymentsRes, chargesRes] = await Promise.all([
    db.from("families").select("*").eq("id", params.id).single(),
    db.from("children").select("*").eq("family_id", params.id).order("last_name"),
    db.from("payments").select("*").eq("family_id", params.id).order("payment_date", { ascending: false }),
    db.from("charges").select("*").eq("family_id", params.id),
  ]);

  if (familyRes.error || !familyRes.data)
    return NextResponse.json({ error: "Family not found" }, { status: 404 });

  // Only count charges for months that have already started. We sum the
  // EUR snapshot column (self-healing for legacy rows) rather than the
  // raw `amount` so cross-currency families produce a meaningful total.
  const now = new Date();
  const currentKey = now.getFullYear() * 12 + (now.getMonth() + 1);
  const charges = (chargesRes.data ?? []) as ChargeEurRow[];
  const payments = (paymentsRes.data ?? []) as PaymentEurRow[];
  const pastCharges = charges.filter(
    (c) => Number(c.year) * 12 + Number(c.month) <= currentKey,
  );

  const currencies = new Set<Currency>();
  for (const r of payments) {
    const c = (r.currency ?? "EUR") as Currency;
    if (c === "EUR" || c === "USD" || c === "GBP") currencies.add(c);
  }
  for (const r of pastCharges) {
    const c = (r.currency ?? "EUR") as Currency;
    if (c === "EUR" || c === "USD" || c === "GBP") currencies.add(c);
  }
  // Ensure family currency is loaded so we can convert opening balance to EUR.
  const familyCcy0 = (familyRes.data.currency ?? "EUR") as Currency;
  if (familyCcy0 === "USD" || familyCcy0 === "GBP") currencies.add(familyCcy0);
  const tables = await loadTablesForCurrencies(db, currencies);
  fillChargeEurInMemory(pastCharges, tables);
  fillPaymentEurInMemory(payments, tables);

  const chargeEur = pastCharges.reduce((s, c) => s + Number(c.eur_amount ?? 0), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.eur_amount ?? 0), 0);

  // Opening balance is stored in family currency; convert to EUR so the
  // summary cards (always EUR) match the statement totals. No per-row
  // date exists, so use the latest known rate.
  const openingLocal = Number(familyRes.data.opening_balance_amount ?? 0);
  let openingEur = 0;
  if (openingLocal > 0) {
    if (familyCcy0 === "EUR") {
      openingEur = openingLocal;
    } else {
      const table = tables.get(familyCcy0);
      const rate = table?.latest ? Number(table.latest.rate) : null;
      if (rate && rate > 0) openingEur = openingLocal / rate;
    }
  }
  const totalCharged = chargeEur + openingEur;

  return NextResponse.json({
    family: familyRes.data,
    children: childrenRes.data ?? [],
    payments: paymentsRes.data ?? [],
    balance: {
      charged: Math.round(totalCharged * 100) / 100,
      paid: Math.round(totalPaid * 100) / 100,
      due: Math.round((totalCharged - totalPaid) * 100) / 100,
    },
  });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["families"]?.includes("edit"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  if (body.currency != null && !(body.currency === "EUR" || body.currency === "USD" || body.currency === "GBP")) {
    return NextResponse.json({ error: "Invalid currency" }, { status: 400 });
  }
  if (body.opening_balance_amount != null) {
    const n = Number(body.opening_balance_amount);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: "Invalid opening balance amount" }, { status: 400 });
    }
    body.opening_balance_amount = n;
  }
  if (body.opening_balance_label != null && typeof body.opening_balance_label !== "string") {
    return NextResponse.json({ error: "Invalid opening balance label" }, { status: 400 });
  }
  const db = createServerClient();
  const { data, error } = await db
    .from("families")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ family: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["families"]?.includes("delete"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const { error } = await db.from("families").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
