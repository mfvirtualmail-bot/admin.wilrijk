import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import {
  ensurePaymentEurAmounts,
  ensureChargeEurAmounts,
  type PaymentEurRow,
  type ChargeEurRow,
} from "@/lib/fx";

async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const r = await validateSession(token);
  return r?.user ?? null;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["families"]?.includes("view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const [famRes, chargesRes, paymentsRes] = await Promise.all([
    db.from("families").select("*").order("name"),
    db.from("charges").select("id, family_id, amount, currency, month, year, eur_amount, eur_rate, eur_rate_date"),
    db.from("payments").select("id, family_id, amount, currency, payment_date, eur_amount, eur_rate, eur_rate_date"),
  ]);
  if (famRes.error) return NextResponse.json({ error: famRes.error.message }, { status: 500 });

  // Compute per-family balance in EUR from the snapshot column. Charges
  // count only if their month has started.
  const now = new Date();
  const currentKey = now.getFullYear() * 12 + (now.getMonth() + 1);

  const chargeRows = ((chargesRes.data ?? []) as Array<ChargeEurRow & { family_id: string }>)
    .filter((c) => Number(c.year) * 12 + Number(c.month) <= currentKey);
  await ensureChargeEurAmounts(db, chargeRows);

  const paymentRows = (paymentsRes.data ?? []) as Array<PaymentEurRow & { family_id: string }>;
  await ensurePaymentEurAmounts(db, paymentRows);

  const byFam = new Map<string, { charged: number; paid: number }>();
  for (const c of chargeRows) {
    if (!byFam.has(c.family_id)) byFam.set(c.family_id, { charged: 0, paid: 0 });
    byFam.get(c.family_id)!.charged += Number(c.eur_amount ?? 0);
  }
  for (const p of paymentRows) {
    if (!byFam.has(p.family_id)) byFam.set(p.family_id, { charged: 0, paid: 0 });
    byFam.get(p.family_id)!.paid += Number(p.eur_amount ?? 0);
  }

  const families = (famRes.data ?? []).map((f) => {
    const b = byFam.get(f.id as string) ?? { charged: 0, paid: 0 };
    const balance_eur = Math.max(0, Math.round((b.charged - b.paid) * 100) / 100);
    return { ...f, balance_eur };
  });

  return NextResponse.json({ families });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["families"]?.includes("add"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { name, father_name, mother_name, address, city, postal_code, phone, email, notes, language } = body;
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const validLang = language === "yi" || language === "en" ? language : "en";

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
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ family: data }, { status: 201 });
}
