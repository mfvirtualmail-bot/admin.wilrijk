import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";

async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const r = await validateSession(token);
  return r?.user ?? null;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["children"]?.includes("view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const familyId = searchParams.get("family_id");

  const db = createServerClient();
  let query = db
    .from("children")
    .select("*, families(name)")
    .order("last_name");
  if (familyId) query = query.eq("family_id", familyId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ children: data });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["children"]?.includes("add"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { family_id, first_name, last_name, monthly_tuition, class_name, date_of_birth, enrollment_date, notes } = body;
  if (!family_id || !first_name?.trim() || !last_name?.trim())
    return NextResponse.json({ error: "family_id, first_name and last_name are required" }, { status: 400 });

  const db = createServerClient();
  const { data, error } = await db
    .from("children")
    .insert({ family_id, first_name: first_name.trim(), last_name: last_name.trim(), monthly_tuition: monthly_tuition ?? 0, class_name, date_of_birth, enrollment_date, notes })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ child: data }, { status: 201 });
}
