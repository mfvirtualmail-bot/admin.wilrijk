import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { convertManyToEur } from "@/lib/fx";
import type { Currency } from "@/lib/types";

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
    db.from("charges").select("id, family_id, amount, currency, month, year"),
    db.from("payments").select("id, family_id, amount, currency, payment_date"),
  ]);
  if (famRes.error) return NextResponse.json({ error: famRes.error.message }, { status: 500 });

  // Compute per-family balance in EUR using the same FX conversion logic
  // as the dashboard (charges counted only if their month has started).
  const now = new Date();
  const currentKey = now.getFullYear() * 12 + (now.getMonth() + 1);

  const chargeRecords = (chargesRes.data ?? [])
    .filter((c) => Number(c.year) * 12 + Number(c.month) <= currentKey)
    .map((c) => ({
      id: `c:${c.id}`,
      familyId: c.family_id as string,
      amount: Number(c.amount),
      currency: ((c.currency as Currency) ?? "EUR") as Currency,
      date: `${c.year}-${String(c.month).padStart(2, "0")}-01`,
    }));
  const paymentRecords = (paymentsRes.data ?? []).map((p) => ({
    id: `p:${p.id}`,
    familyId: p.family_id as string,
    amount: Number(p.amount),
    currency: ((p.currency as Currency) ?? "EUR") as Currency,
    date: String(p.payment_date).slice(0, 10),
  }));

  const chargeConv = await convertManyToEur(
    chargeRecords.map(({ id, amount, currency, date }) => ({ id, amount, currency, date })),
  );
  const paymentConv = await convertManyToEur(
    paymentRecords.map(({ id, amount, currency, date }) => ({ id, amount, currency, date })),
  );

  const byFam = new Map<string, { charged: number; paid: number }>();
  for (let i = 0; i < chargeRecords.length; i++) {
    const fam = chargeRecords[i].familyId;
    if (!byFam.has(fam)) byFam.set(fam, { charged: 0, paid: 0 });
    byFam.get(fam)!.charged += chargeConv.breakdown[i]?.eur ?? 0;
  }
  for (let i = 0; i < paymentRecords.length; i++) {
    const fam = paymentRecords[i].familyId;
    if (!byFam.has(fam)) byFam.set(fam, { charged: 0, paid: 0 });
    byFam.get(fam)!.paid += paymentConv.breakdown[i]?.eur ?? 0;
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
