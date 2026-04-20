import { NextResponse } from "next/server";
import { HDate } from "@hebcal/core";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { generateChargesForChild } from "@/lib/charge-utils";
import type { Currency } from "@/lib/types";

/**
 * Pre-charge the *next* Hebrew month for every active student, before its
 * Rosh Chodesh arrives. This is what the operator uses to send statements
 * a few days ahead of the month (e.g. "here is what you'll owe for
 * Iyyar"). Safe in combination with /api/charges/cron — both upsert on
 * (child_id, hebrew_month, hebrew_year), so whoever runs second is a
 * no-op for any month already billed.
 *
 * GET  → preview: returns the Hebrew month that WOULD be pre-charged
 *         (so the button can show its name), without touching data.
 * POST → executes the pre-charge. Returns both the month name and the
 *         number of charge rows created.
 *
 * Permission: charges:add (or super-admin).
 */

function computeNextHebrewMonth(): { hd: HDate; throughDate: Date } {
  const today = new HDate();
  // Walk to day 1 of NEXT Hebrew month. Hebrew calendar transition from
  // Elul to Tishrei also rolls the year — HDate.add(1, 'month') handles
  // that plus the Adar I → Adar II leap-year step, so we don't have to.
  const dayOneThisMonth = new HDate(1, today.getMonth(), today.getFullYear());
  const nextMonth = dayOneThisMonth.add(1, "month");
  // throughDate is day 1 of the next Hebrew month (its Rosh Chodesh in
  // Gregorian terms). Any Rosh Chodesh whose Gregorian date is <= that
  // will be included — which is exactly: all Hebrew months up to and
  // including "next Hebrew month".
  return { hd: nextMonth, throughDate: nextMonth.greg() };
}

async function requirePermission() {
  const token = cookies().get("session")?.value;
  if (!token) return { err: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const result = await validateSession(token);
  if (!result) return { err: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const user = result.user;
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["charges"]?.includes("add")) {
    return { err: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }
  return { user } as const;
}

export async function GET() {
  const guard = await requirePermission();
  if ("err" in guard) return guard.err;
  const { hd, throughDate } = computeNextHebrewMonth();
  return NextResponse.json({
    hebrewMonth: hd.getMonthName(),
    hebrewMonthNum: hd.getMonth(),
    hebrewYear: hd.getFullYear(),
    throughDate: throughDate.toISOString().slice(0, 10),
  });
}

export async function POST() {
  const guard = await requirePermission();
  if ("err" in guard) return guard.err;

  const { hd, throughDate } = computeNextHebrewMonth();
  const db = createServerClient();

  const { data: children, error } = await db
    .from("children")
    .select("id, family_id, monthly_tuition, currency, enrollment_start_month, enrollment_start_year, enrollment_end_month, enrollment_end_year")
    .eq("is_active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let totalCreated = 0;
  const failures: Array<{ child_id: string; message: string }> = [];
  for (const child of children ?? []) {
    const tuition = Number(child.monthly_tuition);
    if (!isFinite(tuition) || tuition <= 0) continue;
    if (child.enrollment_start_month == null || child.enrollment_start_year == null) continue;
    const currency = (child.currency ?? "EUR") as Currency;
    try {
      const created = await generateChargesForChild(
        db,
        child.id as string,
        child.family_id as string,
        tuition,
        currency,
        child.enrollment_start_month as number,
        child.enrollment_start_year as number,
        child.enrollment_end_month as number | null,
        child.enrollment_end_year as number | null,
        throughDate,
      );
      totalCreated += created;
    } catch (e) {
      failures.push({ child_id: child.id as string, message: (e as Error).message });
    }
  }

  return NextResponse.json({
    ok: true,
    hebrewMonth: hd.getMonthName(),
    hebrewMonthNum: hd.getMonth(),
    hebrewYear: hd.getFullYear(),
    throughDate: throughDate.toISOString().slice(0, 10),
    created: totalCreated,
    failures,
  });
}
