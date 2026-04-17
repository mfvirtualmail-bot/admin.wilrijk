import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { getLatestKnownRates } from "@/lib/fx";

/**
 * GET /api/fx/status
 *
 * Diagnostics: how many rows still need their EUR snapshot, and what the
 * latest rate is per non-EUR currency. The Settings page uses this to
 * drive the "Rebuild snapshots" button and surface stale data to the
 * operator without them needing to open the Supabase console.
 */
export async function GET() {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await validateSession(token);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServerClient();

  const [
    { count: missingPayments },
    { count: missingCharges },
    { count: totalPayments },
    { count: totalCharges },
    latestRates,
  ] = await Promise.all([
    db.from("payments").select("id", { count: "exact", head: true }).is("eur_amount", null),
    db.from("charges").select("id", { count: "exact", head: true }).is("eur_amount", null),
    db.from("payments").select("id", { count: "exact", head: true }),
    db.from("charges").select("id", { count: "exact", head: true }),
    getLatestKnownRates(),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const todayMs = new Date(today).getTime();
  const rates = latestRates.map((r) => {
    const daysOld = Math.round((todayMs - new Date(r.rateDate).getTime()) / (1000 * 60 * 60 * 24));
    return { ...r, daysOld };
  });

  return NextResponse.json({
    today,
    rates,
    missingPayments: missingPayments ?? 0,
    missingCharges: missingCharges ?? 0,
    totalPayments: totalPayments ?? 0,
    totalCharges: totalCharges ?? 0,
  });
}
