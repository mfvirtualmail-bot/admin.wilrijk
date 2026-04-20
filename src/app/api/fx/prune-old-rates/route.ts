import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";

/**
 * POST /api/fx/prune-old-rates?years=N
 *
 * Delete every `exchange_rates` row older than `N` years (default 2).
 * The app never bills anything older than the earliest student
 * enrollment, so keeping decades of history is wasted space — and
 * was the indirect cause of a bug where PostgREST's 1000-row default
 * SELECT limit returned the oldest 1000 rows (1999-2002) instead of
 * the ones we actually needed. Pruning keeps the table comfortably
 * under that limit so even a regression in pagination wouldn't
 * resurface the problem.
 *
 * Super-admin only. Returns the number of rows deleted per currency.
 */
export async function POST(req: Request) {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = await validateSession(token);
  if (!r || !r.user.is_super_admin)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const years = Math.max(1, Math.min(20, Number(url.searchParams.get("years") ?? 2)));
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);
  const cutoffISO = cutoff.toISOString().slice(0, 10);

  const db = createServerClient();
  const { data, error } = await db
    .from("exchange_rates")
    .delete()
    .lt("date", cutoffISO)
    .select("date, currency");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const deleted = data ?? [];
  const byCurrency: Record<string, number> = {};
  for (const row of deleted) {
    const c = String((row as { currency: string }).currency);
    byCurrency[c] = (byCurrency[c] ?? 0) + 1;
  }

  return NextResponse.json({
    cutoffDate: cutoffISO,
    yearsKept: years,
    totalDeleted: deleted.length,
    byCurrency,
  });
}
