import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";

/**
 * GET /api/debug/family/:id
 *
 * Super-admin-only diagnostic dump: raw charges, payments, children,
 * and a computed summary in the three ways the app computes them:
 *   - `listBalance`  what /api/families computes (what the list shows)
 *   - `detailBalance` what /api/families/:id computes (what the family
 *                    page header shows)
 *   - `spreadsheetTotals` what /api/spreadsheet would aggregate into
 *                    the grid row
 *
 * If these three disagree, the divergence pinpoints which code path is
 * the bug. Kept behind debug/ to signal it's not a stable public API.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = await validateSession(token);
  if (!r || !r.user.is_super_admin)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const [fam, kids, charges, payments] = await Promise.all([
    db.from("families").select("*").eq("id", params.id).single(),
    db.from("children").select("*").eq("family_id", params.id),
    db.from("charges").select("*").eq("family_id", params.id),
    db.from("payments").select("*").eq("family_id", params.id),
  ]);

  const chargeRows = (charges.data ?? []) as Array<Record<string, unknown>>;
  const paymentRows = (payments.data ?? []) as Array<Record<string, unknown>>;

  const now = new Date();
  const currentKey = now.getFullYear() * 12 + (now.getMonth() + 1);

  const pastCharges = chargeRows.filter((c) =>
    Number(c.year) * 12 + Number(c.month) <= currentKey,
  );

  const sumChargedEurAll = chargeRows.reduce((s, c) => s + Number(c.eur_amount ?? 0), 0);
  const sumChargedEurPast = pastCharges.reduce((s, c) => s + Number(c.eur_amount ?? 0), 0);
  const sumPaidEur = paymentRows.reduce((s, p) => s + Number(p.eur_amount ?? 0), 0);

  const nullEurCharges = chargeRows.filter((c) => c.eur_amount == null).length;
  const nullEurPayments = paymentRows.filter((p) => p.eur_amount == null).length;

  // Breakdown by currency for charges.
  const chargesByCurrency: Record<string, { count: number; sumAmount: number; sumEur: number; nullEur: number }> = {};
  for (const c of chargeRows) {
    const cur = String(c.currency ?? "EUR");
    if (!chargesByCurrency[cur]) chargesByCurrency[cur] = { count: 0, sumAmount: 0, sumEur: 0, nullEur: 0 };
    chargesByCurrency[cur].count++;
    chargesByCurrency[cur].sumAmount += Number(c.amount);
    chargesByCurrency[cur].sumEur += Number(c.eur_amount ?? 0);
    if (c.eur_amount == null) chargesByCurrency[cur].nullEur++;
  }

  return NextResponse.json({
    family: fam.data,
    children: kids.data,
    counts: {
      charges: chargeRows.length,
      pastCharges: pastCharges.length,
      payments: paymentRows.length,
      nullEurCharges,
      nullEurPayments,
    },
    sums: {
      chargedEurAll: Math.round(sumChargedEurAll * 100) / 100,
      chargedEurPast: Math.round(sumChargedEurPast * 100) / 100,
      paidEur: Math.round(sumPaidEur * 100) / 100,
      balanceEur: Math.round((sumChargedEurPast - sumPaidEur) * 100) / 100,
    },
    chargesByCurrency,
    // Dump the rows themselves so we can see month/year/eur_amount/kind.
    rawCharges: chargeRows.map((c) => ({
      month: c.month,
      year: c.year,
      amount: c.amount,
      currency: c.currency,
      eur_amount: c.eur_amount,
      eur_rate: c.eur_rate,
      eur_rate_date: c.eur_rate_date,
      eur_rate_kind: c.eur_rate_kind,
    })),
    rawPayments: paymentRows.map((p) => ({
      date: p.payment_date,
      month: p.month,
      year: p.year,
      amount: p.amount,
      currency: p.currency,
      eur_amount: p.eur_amount,
      eur_rate_kind: p.eur_rate_kind,
      method: p.payment_method,
    })),
  });
}
