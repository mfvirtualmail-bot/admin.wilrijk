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
    // the spreadsheet only edits amount/method/date/notes inline.
    const { data, error } = await db
      .from("payments")
      .update({
        amount: parsedAmount,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        notes: notes ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ payment: data });
  } else {
    // Create new payment in the family's base currency (passed from the
    // client). That matches where tuition is billed; if the gabbai needs
    // a different currency, he edits the payment on the family page.
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
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ payment: data });
  }
}
