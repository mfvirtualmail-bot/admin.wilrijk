import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { snapshotEurFields } from "@/lib/fx";
import type { Currency } from "@/lib/types";

async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const r = await validateSession(token);
  return r?.user ?? null;
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["charges"]?.includes("edit"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const db = createServerClient();

  // Re-snapshot the EUR equivalent if amount, currency, month or year
  // moved. Charges' "FX date" is the first day of their month.
  const update: Record<string, unknown> = { ...body, updated_at: new Date().toISOString() };
  if ("amount" in body || "currency" in body || "month" in body || "year" in body) {
    const { data: existing } = await db
      .from("charges")
      .select("amount, currency, month, year")
      .eq("id", params.id)
      .single();
    if (existing) {
      const amount = Number(body.amount ?? existing.amount);
      const cur: Currency = ((body.currency ?? existing.currency) ?? "EUR") as Currency;
      const month = Number(body.month ?? existing.month);
      const year = Number(body.year ?? existing.year);
      const date = `${year}-${String(month).padStart(2, "0")}-01`;
      const eur = await snapshotEurFields(amount, cur, date);
      update.eur_amount = eur.eur_amount;
      update.eur_rate = eur.eur_rate;
      update.eur_rate_date = eur.eur_rate_date;
      update.eur_rate_kind = eur.eur_rate_kind;
    }
  }

  const { data, error } = await db
    .from("charges")
    .update(update)
    .eq("id", params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ charge: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["charges"]?.includes("delete"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const { error } = await db.from("charges").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
