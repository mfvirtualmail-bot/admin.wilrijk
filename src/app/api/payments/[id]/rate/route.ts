import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";

/**
 * POST /api/payments/:id/rate
 *
 * Manually override the FX rate applied to THIS payment only. Does not
 * touch the shared `exchange_rates` table — other payments on the same
 * date are unaffected.
 *
 * Body: { rate: number }  // amount of currency per 1 EUR
 *
 * Result: payment row with `eur_amount` recomputed, `eur_rate_kind`
 * stamped as 'manual', and `eur_rate_date` set to today (audit trail of
 * when the operator made the override).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const session = await validateSession(token);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = session.user;
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["payments"]?.includes("edit"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const rate = Number(body.rate);
  if (!isFinite(rate) || rate <= 0)
    return NextResponse.json({ error: "rate must be a positive number" }, { status: 400 });

  const db = createServerClient();
  const { data: existing, error: fetchErr } = await db
    .from("payments")
    .select("amount, currency")
    .eq("id", params.id)
    .single();
  if (fetchErr || !existing)
    return NextResponse.json({ error: fetchErr?.message ?? "Payment not found" }, { status: 404 });

  const amount = Number(existing.amount);
  const currency = (existing.currency ?? "EUR") as string;

  // EUR payments shouldn't be overridden — their rate is always 1. If
  // somehow asked, just refuse rather than silently storing a weird row.
  if (currency === "EUR")
    return NextResponse.json({ error: "Cannot override rate on an EUR payment" }, { status: 400 });

  const eurAmount = Math.round((amount / rate) * 100) / 100;
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await db
    .from("payments")
    .update({
      eur_amount: eurAmount,
      eur_rate: rate,
      eur_rate_date: today,
      eur_rate_kind: "manual",
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .select("*, families(name, father_name)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ payment: data });
}
