import { NextRequest, NextResponse } from "next/server";
import { validateSession } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";

async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const r = await validateSession(token);
  return r?.user ?? null;
}

/** DELETE /api/fx/rates/YYYY-MM-DD/USD
 *  Removes a single manually-edited rate (or, in effect, allows the
 *  resolver to fall back to the previous rate). Super-admin only. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { date: string; currency: string } },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.is_super_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { date, currency } = params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const db = createServerClient();
  const { error } = await db
    .from("exchange_rates")
    .delete()
    .eq("date", date)
    .eq("currency", currency);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
