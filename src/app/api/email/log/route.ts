import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getSessionUser, hasModuleAction } from "@/lib/api-auth";

/** GET /api/email/log?limit=50  — recent send history. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasModuleAction(user.id, user.is_super_admin, "email", "send")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const limit = Math.max(1, Math.min(500, Number(req.nextUrl.searchParams.get("limit") ?? 50)));
  const db = createServerClient();
  const { data, error } = await db
    .from("email_log")
    .select("*, families(name), users(display_name, username)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data });
}
