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

  const [familiesRes, childrenRes, paymentsRes, tuitionRes, chargesRes, recentPaymentsRes] = await Promise.all([
    db.from("families").select("id", { count: "exact" }).eq("is_active", true),
    db.from("children").select("id", { count: "exact" }).eq("is_active", true),
    db.from("payments").select("amount"),
    db.from("children").select("monthly_tuition").eq("is_active", true),
    db.from("charges").select("amount, month, year"),
    db.from("payments")
      .select("id, amount, payment_date, payment_method, currency, families(name, father_name)")
      .order("payment_date", { ascending: false })
      .limit(5),
  ]);

  const totalPaid = (paymentsRes.data ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const monthlyTuitionTotal = (tuitionRes.data ?? []).reduce(
    (s, c) => s + Number(c.monthly_tuition),
    0,
  );
  // Only count charges for months that have already started. Enrollment
  // is already baked into the charges table (see generateChargesForChild),
  // so this one filter covers both "month hasn't arrived" and "student
  // wasn't enrolled yet / has left" cases.
  const now = new Date();
  const currentKey = now.getFullYear() * 12 + (now.getMonth() + 1);
  const totalCharged = (chargesRes.data ?? [])
    .filter((c) => Number(c.year) * 12 + Number(c.month) <= currentKey)
    .reduce((s, c) => s + Number(c.amount), 0);
  const totalDue = Math.max(0, totalCharged - totalPaid);

  return NextResponse.json({
    stats: {
      families: familiesRes.count ?? 0,
      children: childrenRes.count ?? 0,
      totalPaid,
      totalDue,
      totalCharged,
      monthlyExpected: monthlyTuitionTotal,
    },
    recentPayments: recentPaymentsRes.data ?? [],
  });
}
