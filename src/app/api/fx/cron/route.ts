import { NextRequest, NextResponse } from "next/server";
import { fetchEcbDailyRates } from "@/lib/fx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vercel Cron entrypoint. Wired via vercel.json:
 *    { "crons": [{ "path": "/api/fx/cron", "schedule": "0 6 * * *" }] }
 *  Pulls today's ECB rates every morning. Safe to re-run; existing rows
 *  are kept unless a super-admin explicitly forces a refresh from the UI.
 *  Protected by CRON_SECRET if set (same secret as /api/email/cron). */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get("authorization") ?? "";
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    // Nightly cron only needs today's rate — the full 2-year backfill
    // runs on demand from the Advanced-settings "Refresh from ECB" button.
    const result = await fetchEcbDailyRates({ force: false, range: "daily" });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
