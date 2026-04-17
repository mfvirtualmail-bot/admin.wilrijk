import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth";
import { fetchEcbHistoricalRates } from "@/lib/fx";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/fx/fetch-history   Super-admin only.
 *
 * Pulls the ECB full-history daily rates XML (back to 1999) and
 * upserts every USD/GBP row into `exchange_rates`. Use this after the
 * `exchange_rates` table is first created (or re-created), or any time
 * you realise the history has gaps that matter for an existing row's
 * snapshot date.
 *
 * This only POPULATES rates — it does not re-snapshot existing
 * payment/charge rows. For that, call
 * POST /api/fx/rebuild-snapshots?include=fallback.
 */
export async function POST() {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = await validateSession(token);
  if (!r || !r.user.is_super_admin)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const result = await fetchEcbHistoricalRates();
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
