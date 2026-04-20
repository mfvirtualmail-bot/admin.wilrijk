import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";

/**
 * GET /api/debug/fx
 *
 * Dumps per-currency stats from the `exchange_rates` table so we can
 * see exactly what the app has to work with:
 *   - count of rows per currency
 *   - earliest and latest stored date
 *   - a sample of the latest 10 rates
 *   - a sample around a chosen "target" date (?date=YYYY-MM-DD)
 *
 * If the latest date is years in the past, rebuild-snapshots will
 * produce wildly wrong EUR values even though the snapshots will be
 * classified as "historical" (because the stale row's date is still
 * ≤ the payment's date).
 */
export async function GET(req: Request) {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = await validateSession(token);
  if (!r || !r.user.is_super_admin)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const target = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);

  const db = createServerClient();
  const result: Record<string, unknown> = { queryDate: target };
  for (const cur of ["USD", "GBP"] as const) {
    const [
      { count: total },
      { data: latestTen },
      { data: atOrBefore },
      { data: afterTarget },
    ] = await Promise.all([
      db.from("exchange_rates").select("date", { count: "exact", head: true }).eq("currency", cur),
      db.from("exchange_rates")
        .select("date, rate, source")
        .eq("currency", cur)
        .order("date", { ascending: false })
        .limit(10),
      db.from("exchange_rates")
        .select("date, rate, source")
        .eq("currency", cur)
        .lte("date", target)
        .order("date", { ascending: false })
        .limit(3),
      db.from("exchange_rates")
        .select("date, rate, source")
        .eq("currency", cur)
        .gt("date", target)
        .order("date", { ascending: true })
        .limit(3),
    ]);
    result[cur] = {
      total: total ?? 0,
      latest: latestTen?.[0] ?? null,
      earliest: null as unknown,
      latestTen,
      // What pickRate would have to work with around the target date.
      atOrBeforeTarget: atOrBefore,
      afterTarget,
    };
  }

  // Separate query for the earliest per currency (limit 1 asc).
  for (const cur of ["USD", "GBP"] as const) {
    const { data: earliest } = await db
      .from("exchange_rates")
      .select("date, rate, source")
      .eq("currency", cur)
      .order("date", { ascending: true })
      .limit(1);
    (result[cur] as Record<string, unknown>).earliest = earliest?.[0] ?? null;
  }

  return NextResponse.json(result);
}
