import { NextRequest, NextResponse } from "next/server";
import { HDate } from "@hebcal/core";
import { createServerClient } from "@/lib/supabase";
import { generateChargesForChild } from "@/lib/charge-utils";
import type { Currency } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Vercel Cron entrypoint for monthly tuition charges.
 *
 * Wire-up in vercel.json:
 *   { "path": "/api/charges/cron", "schedule": "0 6 * * *" }
 *
 * Vercel crons use Gregorian cron syntax, so we run DAILY and only do
 * work on Rosh Chodesh (day 1 of any Hebrew month, including Rosh
 * Hashana and both Adars in a leap year). On non-Rosh-Chodesh days the
 * endpoint short-circuits and returns { skipped: true }.
 *
 * When it is Rosh Chodesh: generates missing charges for every active
 * student up to today. Safe to run repeatedly because the generator
 * upserts with ignoreDuplicates on UNIQUE(child_id, hebrew_month,
 * hebrew_year) — if an operator pre-charged this Hebrew month via the
 * "Pre-charge next Hebrew month" button, this is a no-op.
 *
 * Protected by CRON_SECRET (same convention as /api/email/cron).
 * Accepts an optional `?force=1` query param for manual test runs that
 * bypass the Rosh-Chodesh check — still requires the secret.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get("authorization") ?? "";
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";

  const today = new Date();
  const hd = new HDate(today);
  const isRoshChodesh = hd.getDate() === 1;

  if (!isRoshChodesh && !force) {
    return NextResponse.json({
      skipped: true,
      reason: "not Rosh Chodesh",
      hebrewDate: `${hd.getDate()} ${hd.getMonthName()} ${hd.getFullYear()}`,
    });
  }

  const db = createServerClient();
  const { data: children, error } = await db
    .from("children")
    .select("id, family_id, monthly_tuition, currency, enrollment_start_month, enrollment_start_year, enrollment_end_month, enrollment_end_year")
    .eq("is_active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let totalCreated = 0;
  let skippedNoTuition = 0;
  let skippedNoStart = 0;
  const failures: Array<{ child_id: string; message: string }> = [];

  for (const child of children ?? []) {
    const tuition = Number(child.monthly_tuition);
    if (!isFinite(tuition) || tuition <= 0) {
      skippedNoTuition++;
      continue;
    }
    if (child.enrollment_start_month == null || child.enrollment_start_year == null) {
      skippedNoStart++;
      continue;
    }
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
      );
      totalCreated += created;
    } catch (e) {
      failures.push({ child_id: child.id as string, message: (e as Error).message });
    }
  }

  return NextResponse.json({
    ok: true,
    roshChodesh: {
      hebrewMonth: hd.getMonthName(),
      hebrewMonthNum: hd.getMonth(),
      hebrewYear: hd.getFullYear(),
      gregDate: today.toISOString().slice(0, 10),
    },
    created: totalCreated,
    studentsProcessed: (children ?? []).length - skippedNoTuition - skippedNoStart,
    studentsSkipped: skippedNoTuition + skippedNoStart,
    failures,
  });
}
