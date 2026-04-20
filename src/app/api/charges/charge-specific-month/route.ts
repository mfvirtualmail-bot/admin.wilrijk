import { NextRequest, NextResponse } from "next/server";
import { HDate } from "@hebcal/core";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { snapshotEurFields } from "@/lib/fx";
import { getEnrollmentMonths } from "@/lib/family-utils";
import type { Currency } from "@/lib/types";

// Per-child FX lookup + upsert can take noticeable time at 100+ students.
// Opt into a longer Vercel budget than the 10s hobby default so the
// endpoint doesn't silently time out mid-loop.
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Charge one specific Hebrew month for every active student.
 *
 * Operator-facing "bill {Hebrew month X} now" action, used when a past
 * or already-started month wasn't billed. The Pre-charge-next-month
 * button only extends the billing horizon forward to the next Rosh
 * Chodesh; it can't fill a month that's already started.
 *
 * GET  — returns a menu of selectable months (12 past + current + 12
 *         future) so the Settings dropdown always shows valid options
 *         with accurate Adar I / Adar II handling in leap years.
 * POST — body { hebrew_month, hebrew_year }: creates the Rosh-Chodesh
 *         charge for THAT Hebrew month for every active student whose
 *         enrollment window covers the Rosh Chodesh Gregorian date.
 *         Idempotent — (child_id, hebrew_month, hebrew_year) is the
 *         unique index, so clicking twice does nothing the second time.
 */

function step(hebrewMonth: number, hebrewYear: number, direction: 1 | -1): { hebrewMonth: number; hebrewYear: number } {
  if (direction === 1) {
    if (hebrewMonth === 6) return { hebrewMonth: 7, hebrewYear: hebrewYear + 1 };
    const n = HDate.monthsInYear(hebrewYear);
    if (hebrewMonth === n) return { hebrewMonth: 1, hebrewYear };
    return { hebrewMonth: hebrewMonth + 1, hebrewYear };
  }
  if (hebrewMonth === 7) return { hebrewMonth: 6, hebrewYear: hebrewYear - 1 };
  if (hebrewMonth === 1) return { hebrewMonth: HDate.monthsInYear(hebrewYear), hebrewYear };
  return { hebrewMonth: hebrewMonth - 1, hebrewYear };
}

async function requirePermission(action: "view" | "add") {
  const token = cookies().get("session")?.value;
  if (!token) return { err: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const result = await validateSession(token);
  if (!result) return { err: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const user = result.user;
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["charges"]?.includes(action)) {
    return { err: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }
  return { user } as const;
}

export async function GET() {
  const guard = await requirePermission("view");
  if ("err" in guard) return guard.err;

  const todayHd = new HDate();
  let hm = todayHd.getMonth();
  let hy = todayHd.getFullYear();
  for (let i = 0; i < 12; i++) ({ hebrewMonth: hm, hebrewYear: hy } = step(hm, hy, -1));

  const options: Array<{ hebrew_month: number; hebrew_year: number; label: string; greg_date: string; is_current: boolean }> = [];
  for (let i = 0; i < 25; i++) {
    const rc = new HDate(1, hm, hy).greg();
    const iso = `${rc.getFullYear()}-${String(rc.getMonth() + 1).padStart(2, "0")}-${String(rc.getDate()).padStart(2, "0")}`;
    options.push({
      hebrew_month: hm,
      hebrew_year: hy,
      label: `${HDate.getMonthName(hm, hy)} ${hy}`,
      greg_date: iso,
      is_current: hm === todayHd.getMonth() && hy === todayHd.getFullYear(),
    });
    ({ hebrewMonth: hm, hebrewYear: hy } = step(hm, hy, 1));
  }

  return NextResponse.json({ options });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission("add");
  if ("err" in guard) return guard.err;

  const body = await req.json().catch(() => ({}));
  const hm = Number(body.hebrew_month);
  const hy = Number(body.hebrew_year);
  if (!Number.isInteger(hm) || hm < 1 || hm > 13) {
    return NextResponse.json({ error: "hebrew_month must be 1..13" }, { status: 400 });
  }
  if (!Number.isInteger(hy) || hy < 5000 || hy > 6000) {
    return NextResponse.json({ error: "hebrew_year looks wrong" }, { status: 400 });
  }
  if (hm > HDate.monthsInYear(hy)) {
    return NextResponse.json({
      error: `Hebrew year ${hy} has only ${HDate.monthsInYear(hy)} months — month ${hm} is out of range.`,
    }, { status: 400 });
  }

  const rcDate = new HDate(1, hm, hy).greg();
  const rcGregMonth = rcDate.getMonth() + 1;
  const rcGregYear = rcDate.getFullYear();
  const rcIso = `${rcGregYear}-${String(rcGregMonth).padStart(2, "0")}-${String(rcDate.getDate()).padStart(2, "0")}`;

  const db = createServerClient();
  const { data: children, error } = await db
    .from("children")
    .select("id, family_id, monthly_tuition, currency, enrollment_start_month, enrollment_start_year, enrollment_end_month, enrollment_end_year")
    .eq("is_active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // First pass: synchronous filtering. Figures out exactly which
  // children are eligible — fast because it hits no DB / FX — and
  // returns their tuition/currency/ids. We'll run FX snapshots for just
  // the eligible set in parallel, rather than sequentially for every
  // student the caller didn't actually need.
  let skippedNoTuition = 0;
  let skippedNoStart = 0;
  let skippedOutOfWindow = 0;
  const eligible: Array<{ childId: string; familyId: string; tuition: number; currency: Currency }> = [];

  for (const child of children ?? []) {
    const tuition = Number(child.monthly_tuition);
    if (!isFinite(tuition) || tuition <= 0) { skippedNoTuition++; continue; }
    if (child.enrollment_start_month == null || child.enrollment_start_year == null) { skippedNoStart++; continue; }

    // Check whether rcDate's Gregorian (month, year) is inside the
    // student's enrollment window — the "is this Rosh Chodesh inside
    // the enrollment window?" guard.
    const greg = getEnrollmentMonths(
      child.enrollment_start_month as number,
      child.enrollment_start_year as number,
      child.enrollment_end_month as number | null,
      child.enrollment_end_year as number | null,
      rcDate,
    );
    const insideWindow = greg.some((g) => g.month === rcGregMonth && g.year === rcGregYear);
    if (!insideWindow) { skippedOutOfWindow++; continue; }

    eligible.push({
      childId: child.id as string,
      familyId: child.family_id as string,
      tuition,
      currency: (child.currency ?? "EUR") as Currency,
    });
  }

  // Second pass: FX snapshots in parallel. Each student's snapshot is
  // an independent DB lookup, so Promise.all cuts wall time from N
  // sequential round-trips to one.
  const rows = await Promise.all(
    eligible.map(async (e) => {
      const eur = await snapshotEurFields(e.tuition, e.currency, rcIso);
      return {
        child_id: e.childId,
        family_id: e.familyId,
        month: rcGregMonth,
        year: rcGregYear,
        hebrew_month: hm,
        hebrew_year: hy,
        amount: e.tuition,
        currency: e.currency,
        eur_amount: eur.eur_amount,
        eur_rate: eur.eur_rate,
        eur_rate_date: eur.eur_rate_date,
        eur_rate_kind: eur.eur_rate_kind,
      };
    }),
  );

  let created = 0;
  if (rows.length > 0) {
    const { data, error: upErr } = await db
      .from("charges")
      .upsert(rows, { onConflict: "child_id,hebrew_month,hebrew_year", ignoreDuplicates: true })
      .select("id");
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    created = data?.length ?? 0;
  }

  return NextResponse.json({
    ok: true,
    hebrewMonth: HDate.getMonthName(hm, hy),
    hebrewMonthNum: hm,
    hebrewYear: hy,
    gregDate: rcIso,
    eligibleStudents: rows.length,
    created,
    alreadyBilled: rows.length - created,
    skippedNoTuition,
    skippedNoStart,
    skippedOutOfWindow,
  });
}
