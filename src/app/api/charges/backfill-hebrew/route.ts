import { NextResponse } from "next/server";
import { HDate } from "@hebcal/core";
import { validateSession } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";

/**
 * POST /api/charges/backfill-hebrew
 *
 * One-shot migration helper. After running migration 006 (which adds the
 * nullable hebrew_month / hebrew_year columns), call this endpoint to
 * fill those columns for every existing charge row.
 *
 * For each row we take the Gregorian (month, year) it was billed under
 * and compute the Hebrew month/year of day 1 of that Gregorian month —
 * which is exactly what the new generator would have stamped had it been
 * in place. Result is deterministic and idempotent: rows already having
 * hebrew_month set are skipped, so re-running is safe.
 *
 * Super-admin only; modifies every charge row.
 */
export async function POST() {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await validateSession(token);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!result.user.is_super_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = createServerClient();

  // Pull every row still lacking Hebrew identity.
  const { data: rows, error } = await db
    .from("charges")
    .select("id, month, year")
    .is("hebrew_month", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let updated = 0;
  const failures: Array<{ id: string; message: string }> = [];

  for (const row of rows ?? []) {
    try {
      const m = Number(row.month);
      const y = Number(row.year);
      if (!Number.isInteger(m) || !Number.isInteger(y) || m < 1 || m > 12) {
        failures.push({ id: row.id, message: `invalid Gregorian (month=${row.month}, year=${row.year})` });
        continue;
      }
      // HDate(Date) → Hebrew date. We use day 1 of the Gregorian month as
      // the anchor — this matches how the old generator chose a billing
      // month and what the new generator's snapshot date would be for
      // that same charge. On a leap year where the old code wrote one
      // charge for "Adar" (plain), hebcal will return whichever Adar
      // contains day 1 of that Gregorian month — usually Adar I for
      // early-Feb, Adar II for early-March. Good enough for history;
      // the new generator is precise going forward.
      const hd = new HDate(new Date(y, m - 1, 1));
      const hm = hd.getMonth();
      const hy = hd.getFullYear();
      const { error: updErr } = await db
        .from("charges")
        .update({ hebrew_month: hm, hebrew_year: hy })
        .eq("id", row.id);
      if (updErr) {
        failures.push({ id: row.id as string, message: updErr.message });
        continue;
      }
      updated++;
    } catch (e) {
      failures.push({ id: row.id as string, message: (e as Error).message });
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: (rows ?? []).length,
    updated,
    failures,
  });
}
