import { NextRequest, NextResponse } from "next/server";
import { validateSession } from "@/lib/auth";
import { fetchEcbDailyRates } from "@/lib/fx";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const r = await validateSession(token);
  return r?.user ?? null;
}

/** POST /api/fx/refresh?force=1   Super-admin only.
 *  Pulls the ECB daily reference XML and upserts USD+GBP rates for today.
 *  With force=1, overwrites any existing row for that date/currency. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.is_super_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const force = new URL(req.url).searchParams.get("force") === "1";

  try {
    const result = await fetchEcbDailyRates({ force });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
