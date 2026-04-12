import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.cookies.get("session")?.value;

  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const result = await validateSession(token);

  if (!result) {
    return NextResponse.json({ error: "Session expired" }, { status: 401 });
  }

  const permissions = result.user.is_super_admin
    ? null // super admin has all permissions
    : await getUserPermissions(result.user.id);

  return NextResponse.json({
    user: result.user,
    permissions,
  });
}
