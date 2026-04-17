import { NextRequest, NextResponse } from "next/server";
import { validateSession, getUserPermissions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { snapshotEurFields } from "@/lib/fx";
import type { Currency } from "@/lib/types";

async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const r = await validateSession(token);
  return r?.user ?? null;
}

interface ImportPayment {
  family_name: string;
  family_id?: string; // If provided, use directly instead of name matching
  month: number;
  year: number;
  payment_date: string | null;
  payment_method: string;
  amount: number;
  currency?: string;
  notes: string | null;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["payments"]?.includes("add"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { payments, currency: defaultCurrency } = body as { payments: ImportPayment[]; currency?: string };

  if (!Array.isArray(payments) || payments.length === 0)
    return NextResponse.json({ error: "No payment data provided" }, { status: 400 });

  const db = createServerClient();

  // Build family name → id map as fallback (case-insensitive by name + father_name)
  const { data: familyRows } = await db.from("families").select("id, name, father_name");
  const familyMap = new Map<string, string>();
  (familyRows ?? []).forEach((f: { id: string; name: string; father_name: string | null }) => {
    // Index by plain name (for Excel matching) and by name|father_name
    familyMap.set(f.name.toLowerCase().trim(), f.id);
    if (f.father_name) {
      familyMap.set(`${f.name.toLowerCase().trim()}|${f.father_name.toLowerCase().trim()}`, f.id);
    }
  });

  const validPayments: {
    family_id: string;
    amount: number;
    payment_date: string;
    payment_method: string;
    month: number | null;
    year: number | null;
    currency: string;
    notes: string | null;
  }[] = [];

  const errors: Array<{ row: number; family: string; message: string }> = [];
  let skipped = 0;

  // Read the admin-configured method codes from settings so that custom
  // methods added under Settings → Payment Methods are also accepted.
  const { data: settingsRows } = await db
    .from("settings")
    .select("key, value")
    .eq("key", "payment_method_labels");
  const configuredLabels = (settingsRows?.[0]?.value ?? {}) as Record<string, string>;
  const validMethods = new Set<string>([
    "crc", "kas", "bank", "other",
    ...Object.keys(configuredLabels),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  payments.forEach((p, idx) => {
    const row = idx + 1;

    // Use family_id from frontend if provided, otherwise fall back to name matching
    let familyId = p.family_id;
    if (!familyId) {
      familyId = familyMap.get(p.family_name.toLowerCase().trim());
    }
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
      currency: p.currency || defaultCurrency || "EUR",
      notes: p.notes,
    });
  });

  let imported = 0;
  if (validPayments.length > 0) {
    // Snapshot the EUR equivalent on each row up-front so imported
    // payments don't need any post-hoc backfill.
    const withEur = await Promise.all(
      validPayments.map(async (p) => {
        const eur = await snapshotEurFields(Number(p.amount), (p.currency as Currency) ?? "EUR", p.payment_date);
        return {
          ...p,
          eur_amount: eur.eur_amount,
          eur_rate: eur.eur_rate,
          eur_rate_date: eur.eur_rate_date,
          eur_rate_kind: eur.eur_rate_kind,
        };
      }),
    );
    const { error, data } = await db
      .from("payments")
      .insert(withEur)
      .select("id");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    imported = data?.length ?? validPayments.length;
  }

  return NextResponse.json({ imported, skipped, errors });
}
