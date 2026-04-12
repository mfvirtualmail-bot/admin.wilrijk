import { NextRequest, NextResponse } from "next/server";
import { validateSession, hashPassword, generateSalt, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";

async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const result = await validateSession(token);
  return result?.user ?? null;
}

// GET /api/users/[id]
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  const canView = user.is_super_admin || perms["users"]?.includes("view");
  if (!canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const { data: targetUser, error } = await db
    .from("users")
    .select("id, username, display_name, language, is_super_admin, is_active, created_at, updated_at")
    .eq("id", params.id)
    .single();

  if (error || !targetUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const { data: permissions } = await db
    .from("user_permissions")
    .select("module, action")
    .eq("user_id", params.id);

  return NextResponse.json({ user: targetUser, permissions: permissions || [] });
}

// PUT /api/users/[id]
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  const canEdit = user.is_super_admin || perms["users"]?.includes("edit");
  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { display_name, language, is_super_admin, is_active, password } = body;

  const db = createServerClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (display_name !== undefined) updates.display_name = display_name;
  if (language !== undefined) updates.language = language;
  if (is_active !== undefined) updates.is_active = is_active;
  // Only super admin can change super_admin flag
  if (is_super_admin !== undefined && user.is_super_admin) {
    updates.is_super_admin = is_super_admin;
  }
  if (password) {
    const salt = generateSalt();
    updates.salt = salt;
    updates.password_hash = await hashPassword(password, salt);
  }

  const { data, error } = await db
    .from("users")
    .update(updates)
    .eq("id", params.id)
    .select("id, username, display_name, language, is_super_admin, is_active, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ user: data });
}

// DELETE /api/users/[id]
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  const canDelete = user.is_super_admin || perms["users"]?.includes("delete");
  if (!canDelete) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Prevent self-deletion
  if (params.id === user.id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  const db = createServerClient();
  const { error } = await db.from("users").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
