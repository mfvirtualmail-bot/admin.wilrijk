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

// PUT /api/spreadsheet/cell — upsert or delete a payment for one family+month
export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["spreadsheet"]?.includes("edit"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { familyId, month, year, amount, method, date, notes, paymentId, currency } = await req.json();

  if (!familyId || !month || !year)
    return NextResponse.json({ error: "familyId, month and year are required" }, { status: 400 });

  const db = createServerClient();

  // If amount is null/empty/zero, delete the payment
  const parsedAmount = amount !== null && amount !== "" ? Number(amount) : null;

  if (parsedAmount === null || parsedAmount === 0) {
    if (paymentId) {
      await db.from("payments").delete().eq("id", paymentId);
    }
    return NextResponse.json({ deleted: true, paymentId: null });
  }

  const paymentDate = date || new Date().toISOString().slice(0, 10);
  const paymentMethod = method || "kas";
  const parsedCurrency =
    currency === "EUR" || currency === "USD" || currency === "GBP" ? currency : "EUR";

  if (paymentId) {
    // Update existing payment — do NOT change its currency from here;
    // the spreadsheet only edits amount/method/date/notes inline. We
    // still re-snapshot the EUR equivalent because amount and date
    // can both have moved.
    const { data: existing } = await db
      .from("payments")
      .select("currency")
      .eq("id", paymentId)
      .single();
    const cur: Currency = ((existing?.currency ?? parsedCurrency) ?? "EUR") as Currency;
    const eur = await snapshotEurFields(parsedAmount, cur, paymentDate);

    const { data, error } = await db
      .from("payments")
      .update({
        amount: parsedAmount,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        notes: notes ?? null,
        eur_amount: eur.eur_amount,
        eur_rate: eur.eur_rate,
        eur_rate_date: eur.eur_rate_date,
        eur_rate_kind: eur.eur_rate_kind,
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ payment: data });
  } else {
    // Create new payment in the family's base currency (passed from the
    // client). Snapshot the EUR equivalent at the rate for `paymentDate`.
    const eur = await snapshotEurFields(parsedAmount, parsedCurrency as Currency, paymentDate);
    const { data, error } = await db
      .from("payments")
      .insert({
        family_id: familyId,
        amount: parsedAmount,
        currency: parsedCurrency,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        month: Number(month),
        year: Number(year),
        notes: notes ?? null,
        eur_amount: eur.eur_amount,
        eur_rate: eur.eur_rate,
        eur_rate_date: eur.eur_rate_date,
        eur_rate_kind: eur.eur_rate_kind,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ payment: data });
  }
}
