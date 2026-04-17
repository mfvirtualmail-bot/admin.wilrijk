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
 * POST /api/fx/rebuild-snapshots?limit=N&include=fallback
 *
 * Durable backfill of `eur_amount / eur_rate / eur_rate_date /
 * eur_rate_kind` for payment + charge rows. Hot paths no longer
 * self-heal — they compute EUR in memory — so this endpoint is the
 * single place that writes snapshots back to the DB.
 *
 * By default operates on rows where `eur_amount IS NULL`.
 *
 * With `?include=fallback` it ALSO includes rows whose current
 * `eur_rate_kind = 'fallback'` — i.e. rows whose snapshot used a later
 * rate because no historical one was available at write time. After
 * you backfill historical ECB rates (via /api/fx/fetch-history), pass
 * `include=fallback` to re-snapshot those rows at the correct
 * historical rate. `manual` rows are NEVER touched — those were set
 * deliberately by an operator.
 *
 * `?limit=N` (default 500) caps rows-per-call to avoid serverless
 * timeouts. Returns `{updatedPayments, updatedCharges,
 * remainingPayments, remainingCharges}` so the caller can loop.
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
  const includeFallback = url.searchParams.get("include") === "fallback";

  const db = createServerClient();

  // Kick ECB once to maximise our chances of having rates.
  try { await ensureEcbRefreshed(); } catch { /* keep going even if ECB is down */ }

  // If we're resnapshotting fallback rows, NULL them out first so the
  // standard `is eur_amount null` path picks them up. Note the
  // unqualified (fallback) NULL — we explicitly DO NOT touch 'manual'.
  if (includeFallback) {
    await Promise.all([
      db.from("payments").update({
        eur_amount: null,
        eur_rate: null,
        eur_rate_date: null,
        eur_rate_kind: null,
      }).eq("eur_rate_kind", "fallback"),
      db.from("charges").update({
        eur_amount: null,
        eur_rate: null,
        eur_rate_date: null,
        eur_rate_kind: null,
      }).eq("eur_rate_kind", "fallback"),
    ]);
  }

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
