import { NextRequest, NextResponse } from "next/server";
import { validateSession } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { ALL_MODULES, MODULE_ACTIONS, type PermissionModule, type PermissionAction } from "@/lib/types";

async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const result = await validateSession(token);
  return result?.user ?? null;
}

// PUT /api/users/[id]/permissions — replace all permissions for a user
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only super admins can manage permissions
  if (!user.is_super_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // permissions: array of { module, action } objects
  const { permissions } = await req.json() as { permissions: { module: string; action: string }[] };

  // Validate each permission
  for (const p of permissions) {
    const mod = p.module as PermissionModule;
    const act = p.action as PermissionAction;
    if (!ALL_MODULES.includes(mod)) {
      return NextResponse.json({ error: `Invalid module: ${mod}` }, { status: 400 });
    }
    if (!MODULE_ACTIONS[mod].includes(act)) {
      return NextResponse.json({ error: `Invalid action ${act} for module ${mod}` }, { status: 400 });
    }
  }

  const db = createServerClient();

  // Delete all existing permissions for this user, then insert new ones
  const { error: deleteError } = await db
    .from("user_permissions")
    .delete()
    .eq("user_id", params.id);

  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  if (permissions.length > 0) {
    const rows = permissions.map((p) => ({
      user_id: params.id,
      module: p.module,
      action: p.action,
    }));

    const { error: insertError } = await db.from("user_permissions").insert(rows);
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: permissions.length });
}
