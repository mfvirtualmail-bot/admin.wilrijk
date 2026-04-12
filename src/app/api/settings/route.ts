import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";

export async function GET() {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await validateSession(token);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServerClient();
  const { data, error } = await db.from("settings").select("key, value");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Convert array of {key,value} to a flat object
  const settings: Record<string, unknown> = {};
  for (const row of data ?? []) {
    settings[row.key] = row.value;
  }
  return NextResponse.json({ settings });
}

export async function PUT(req: Request) {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await validateSession(token);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!result.user.is_super_admin)
    return NextResponse.json({ error: "Forbidden: super admin only" }, { status: 403 });

  const body = await req.json();
  const db = createServerClient();

  // Upsert each key provided
  const allowed = ["school_name", "currency", "academic_year_start_month", "academic_year_end_month",
    "payment_method_labels", "default_payment_method"];
  const updates: { key: string; value: unknown; updated_at: string }[] = [];

  for (const key of allowed) {
    if (key in body) {
      updates.push({ key, value: body[key], updated_at: new Date().toISOString() });
    }
  }

  if (updates.length === 0) return NextResponse.json({ error: "No valid keys provided" }, { status: 400 });

  const { error } = await db.from("settings").upsert(updates, { onConflict: "key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
