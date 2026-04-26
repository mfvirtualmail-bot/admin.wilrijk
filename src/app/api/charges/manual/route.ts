import { NextRequest, NextResponse } from "next/server";
import { HDate } from "@hebcal/core";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { snapshotEurFields } from "@/lib/fx";
import type { Currency } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-child per-Hebrew-month manual charge entry.
 *
 * Used to seed historical years for students whose tuition in those
 * years wasn't ever recorded. Unlike `/api/charges/charge-specific-month`,
 * which bills EVERY active student for a given Hebrew month, this route
 * creates a single (child, hebrew_month, hebrew_year) charge with an
 * optional override amount — useful when a historical tuition amount
 * differed from the student's current `monthly_tuition`.
 *
 * Body:
 *   - child_id      required — the student to bill
 *   - hebrew_month  required — hebcal numbering, 1..13
 *   - hebrew_year   required — e.g. 5784
 *   - amount        optional — defaults to the child's monthly_tuition
 *   - currency      optional — defaults to the child's currency
 *   - notes         optional
 *
 * Returns 409 if a charge for this (child, hebrew_month, hebrew_year)
 * already exists. Use DELETE on /api/charges/[id] to remove first if
 * you want to replace it.
 */
export async function POST(req: NextRequest) {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const session = await validateSession(token);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(session.user.id);
  if (!session.user.is_super_admin && !perms["charges"]?.includes("add")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const childId = typeof body.child_id === "string" ? body.child_id : "";
  const hm = Number(body.hebrew_month);
  const hy = Number(body.hebrew_year);

  if (!childId) return NextResponse.json({ error: "child_id is required" }, { status: 400 });
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

  const db = createServerClient();
  const { data: child, error: chErr } = await db
    .from("children")
    .select("id, family_id, monthly_tuition, currency")
    .eq("id", childId)
    .single();
  if (chErr || !child) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const childTuition = Number(child.monthly_tuition);
  let amount = typeof body.amount === "number" || typeof body.amount === "string"
    ? Number(body.amount)
    : childTuition;
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number (either pass one or set the student's monthly tuition)" }, { status: 400 });
  }
  amount = Math.round(amount * 100) / 100;

  const currency: Currency = ((body.currency as Currency) ?? (child.currency as Currency) ?? "EUR");
  if (currency !== "EUR" && currency !== "USD" && currency !== "GBP") {
    return NextResponse.json({ error: "currency must be EUR, USD or GBP" }, { status: 400 });
  }

  // Snapshot EUR at the Rosh Chodesh for that Hebrew month so the
  // charge stores a historically-accurate FX rate just like the
  // automatic generator does.
  const rcDate = new HDate(1, hm, hy).greg();
  const rcIso = `${rcDate.getFullYear()}-${String(rcDate.getMonth() + 1).padStart(2, "0")}-${String(rcDate.getDate()).padStart(2, "0")}`;
  const eur = await snapshotEurFields(amount, currency, rcIso);

  const { data: inserted, error: insErr } = await db
    .from("charges")
    .insert({
      child_id: child.id,
      family_id: child.family_id,
      month: rcDate.getMonth() + 1,
      year: rcDate.getFullYear(),
      hebrew_month: hm,
      hebrew_year: hy,
      amount,
      currency,
      notes: typeof body.notes === "string" && body.notes.length > 0 ? body.notes : null,
      eur_amount: eur.eur_amount,
      eur_rate: eur.eur_rate,
      eur_rate_date: eur.eur_rate_date,
      eur_rate_kind: eur.eur_rate_kind,
    })
    .select()
    .single();

  if (insErr) {
    // 23505 = unique violation on (child_id, hebrew_month, hebrew_year)
    const code = (insErr as unknown as { code?: string }).code;
    if (code === "23505") {
      return NextResponse.json({
        error: `A charge for ${HDate.getMonthName(hm, hy)} ${hy} already exists for this student. Delete it first if you want to replace it.`,
      }, { status: 409 });
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    charge: inserted,
    hebrewMonth: HDate.getMonthName(hm, hy),
  }, { status: 201 });
}
