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

// GET /api/users — list all users
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  const canView = user.is_super_admin || perms["users"]?.includes("view");
  if (!canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const { data, error } = await db
    .from("users")
    .select("id, username, display_name, language, is_super_admin, is_active, created_at, updated_at")
    .order("display_name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data });
}

// POST /api/users — create user
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  const canAdd = user.is_super_admin || perms["users"]?.includes("add");
  if (!canAdd) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { username, password, display_name, language, is_super_admin } = body;

  if (!username || !password || !display_name) {
    return NextResponse.json({ error: "username, password and display_name are required" }, { status: 400 });
  }

  const salt = generateSalt();
  const password_hash = await hashPassword(password, salt);

  const db = createServerClient();
  const { data, error } = await db
    .from("users")
    .insert({
      username,
      password_hash,
      salt,
      display_name,
      language: language || "en",
      is_super_admin: user.is_super_admin ? (is_super_admin ?? false) : false,
      is_active: true,
    })
    .select("id, username, display_name, language, is_super_admin, is_active, created_at, updated_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Username already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: data }, { status: 201 });
}
