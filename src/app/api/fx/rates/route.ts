import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { getLatestKnownRates } from "@/lib/fx";
import type { Currency, FxSource } from "@/lib/types";

async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const r = await validateSession(token);
  return r?.user ?? null;
}

/** GET /api/fx/rates?currency=GBP  (optional filter)
 * Returns the list of exchange rates, newest first. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["settings"]?.includes("view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const currency = url.searchParams.get("currency");

  const db = createServerClient();
  let query = db
    .from("exchange_rates")
    .select("date, currency, rate, source, updated_at")
    .order("date", { ascending: false });
  if (currency) query = query.eq("currency", currency);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Also surface a per-currency "latest known" snapshot. This is what
  // the EUR conversion will fall back to if a payment/charge is created
  // for a date that has no rate published — surfacing it in Settings
  // means you can see exactly which historical rate the app would
  // reuse if ECB ever stopped responding.
  const latest = await getLatestKnownRates();

  return NextResponse.json({ rates: data ?? [], latest });
}

/** POST /api/fx/rates   Body: { date, currency, rate, source? }
 *  Upserts a manually-edited rate. source defaults to 'manual'. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.is_super_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { date, currency, rate, source } = body as {
    date?: string;
    currency?: Currency;
    rate?: number;
    source?: FxSource;
  };

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  if (!currency || currency === "EUR" || !["USD", "GBP"].includes(currency)) {
    return NextResponse.json({ error: "Invalid currency" }, { status: 400 });
  }
  if (typeof rate !== "number" || !isFinite(rate) || rate <= 0) {
    return NextResponse.json({ error: "Invalid rate" }, { status: 400 });
  }

  const db = createServerClient();
  const { error } = await db
    .from("exchange_rates")
    .upsert(
      { date, currency, rate, source: source ?? "manual", updated_at: new Date().toISOString() },
      { onConflict: "date,currency" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
