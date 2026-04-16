import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { cookies } from "next/headers";
import { listRates, putRate } from "@/lib/fx";
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
  const currency = url.searchParams.get("currency") as Currency | null;

  try {
    const rates = await listRates(currency ? { currency } : {});
    return NextResponse.json({ rates });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
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

  try {
    await putRate(date, currency, rate, source ?? "manual");
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
