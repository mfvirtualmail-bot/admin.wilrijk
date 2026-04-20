import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { regenerateChargesForChild } from "@/lib/charge-utils";

async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const r = await validateSession(token);
  return r?.user ?? null;
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["children"]?.includes("edit"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const db = createServerClient();

  // Check if tuition or enrollment changed (need old values to compare)
  const tuitionOrEnrollmentChanged = "monthly_tuition" in body
    || "enrollment_start_month" in body || "enrollment_start_year" in body
    || "enrollment_end_month" in body || "enrollment_end_year" in body;

  const { data, error } = await db
    .from("children")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-regenerate charges (destructive — wipes this child's existing
  // charges and rebuilds from start → min(end, today)) when tuition or
  // enrollment dates move. Any charges the student shouldn't have
  // (e.g. from a previously too-wide enrollment window) are cleaned up.
  if (data && tuitionOrEnrollmentChanged) {
    try {
      const childCurrency = data.currency ?? "EUR";
      await regenerateChargesForChild(
        db, data.id, data.family_id, Number(data.monthly_tuition), childCurrency,
        data.enrollment_start_month, data.enrollment_start_year,
        data.enrollment_end_month, data.enrollment_end_year,
      );
    } catch (e) {
      console.error("[children PUT] charge regeneration failed:", (e as Error).message);
    }
  }

  return NextResponse.json({ child: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["children"]?.includes("delete"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const { error } = await db.from("children").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
