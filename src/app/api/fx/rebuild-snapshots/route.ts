import { NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import {
  ensurePaymentEurAmounts,
  ensureChargeEurAmounts,
  ensureEcbRefreshed,
  type PaymentEurRow,
  type ChargeEurRow,
} from "@/lib/fx";

/**
 * POST /api/fx/rebuild-snapshots
 *
 * Durable backfill of `eur_amount / eur_rate / eur_rate_date /
 * eur_rate_kind` for every payment + charge row where they're NULL.
 * Hot paths (dashboard, spreadsheet, reports) no longer self-heal —
 * they compute EUR in memory — so this endpoint is the one place
 * that writes snapshots back to the DB.
 *
 * Accepts `?limit=N` (default 500) so extremely large datasets can be
 * walked in batches without timing out a single serverless invocation.
 * Returns `{ updatedPayments, updatedCharges, remainingPayments,
 * remainingCharges }` so the caller knows whether to invoke it again.
 */
export async function POST(req: Request) {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await validateSession(token);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = result.user;
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["settings"]?.includes("edit"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(5000, Number(url.searchParams.get("limit") ?? 500)));

  const db = createServerClient();

  // Kick ECB once to maximise our chances of having rates.
  try { await ensureEcbRefreshed(); } catch { /* keep going even if ECB is down */ }

  const [{ data: payRows, error: payErr }, { data: chgRows, error: chgErr }] = await Promise.all([
    db
      .from("payments")
      .select("id, amount, currency, payment_date, eur_amount, eur_rate, eur_rate_date, eur_rate_kind")
      .is("eur_amount", null)
      .limit(limit),
    db
      .from("charges")
      .select("id, amount, currency, month, year, eur_amount, eur_rate, eur_rate_date, eur_rate_kind")
      .is("eur_amount", null)
      .limit(limit),
  ]);
  if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });
  if (chgErr) return NextResponse.json({ error: chgErr.message }, { status: 500 });

  const paymentsBefore = (payRows ?? []) as PaymentEurRow[];
  const chargesBefore = (chgRows ?? []) as ChargeEurRow[];

  await ensurePaymentEurAmounts(db, paymentsBefore);
  await ensureChargeEurAmounts(db, chargesBefore);

  const updatedPayments = paymentsBefore.filter((r) => r.eur_amount != null).length;
  const updatedCharges = chargesBefore.filter((r) => r.eur_amount != null).length;

  // Count what's still unfilled so the caller knows whether to loop.
  const [{ count: remainingPayments }, { count: remainingCharges }] = await Promise.all([
    db.from("payments").select("id", { count: "exact", head: true }).is("eur_amount", null),
    db.from("charges").select("id", { count: "exact", head: true }).is("eur_amount", null),
  ]);

  return NextResponse.json({
    updatedPayments,
    updatedCharges,
    remainingPayments: remainingPayments ?? 0,
    remainingCharges: remainingCharges ?? 0,
  });
}
