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

interface ImportPayment {
  family_name: string;
  month: number;
  year: number;
  payment_date: string | null;
  payment_method: string;
  amount: number;
  notes: string | null;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["payments"]?.includes("add"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { payments } = body as { payments: ImportPayment[] };

  if (!Array.isArray(payments) || payments.length === 0)
    return NextResponse.json({ error: "No payment data provided" }, { status: 400 });

  const db = createServerClient();

  // Build family name → id map (case-insensitive)
  const { data: familyRows } = await db.from("families").select("id, name");
  const familyMap = new Map<string, string>(); // lower-name → id
  (familyRows ?? []).forEach((f: { id: string; name: string }) => {
    familyMap.set(f.name.toLowerCase().trim(), f.id);
  });

  const validPayments: {
    family_id: string;
    amount: number;
    payment_date: string;
    payment_method: string;
    month: number | null;
    year: number | null;
    notes: string | null;
  }[] = [];

  const errors: Array<{ row: number; family: string; message: string }> = [];
  let skipped = 0;

  const validMethods = new Set(["crc", "kas", "bank", "other"]);
  const today = new Date().toISOString().slice(0, 10);

  payments.forEach((p, idx) => {
    const row = idx + 1;
    const familyId = familyMap.get(p.family_name.toLowerCase().trim());
    if (!familyId) {
      errors.push({ row, family: p.family_name, message: `Family "${p.family_name}" not found in database` });
      return;
    }

    if (!p.amount || p.amount <= 0) { skipped++; return; }

    const method = validMethods.has(p.payment_method) ? p.payment_method : "other";
    const paymentDate = p.payment_date || today;

    validPayments.push({
      family_id: familyId,
      amount: p.amount,
      payment_date: paymentDate,
      payment_method: method,
      month: p.month ?? null,
      year: p.year ?? null,
      notes: p.notes,
    });
  });

  let imported = 0;
  if (validPayments.length > 0) {
    const { error, data } = await db
      .from("payments")
      .insert(validPayments)
      .select("id");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    imported = data?.length ?? validPayments.length;
  }

  return NextResponse.json({ imported, skipped, errors });
}
