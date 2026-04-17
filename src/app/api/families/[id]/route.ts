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
  const tables = await loadTablesForCurrencies(db, currencies);
  fillChargeEurInMemory(pastCharges, tables);
  fillPaymentEurInMemory(payments, tables);

  const totalCharged = pastCharges.reduce((s, c) => s + Number(c.eur_amount ?? 0), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.eur_amount ?? 0), 0);

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
