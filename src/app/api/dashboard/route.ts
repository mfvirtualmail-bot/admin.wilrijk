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

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const [familiesRes, childrenRes, paymentsRes, chargesAllRes, monthlyRes, recentPaymentsRes] = await Promise.all([
    db.from("families").select("id", { count: "exact" }).eq("is_active", true),
    db.from("children").select("id", { count: "exact" }).eq("is_active", true),
    db.from("payments").select("amount"),
    db.from("charges").select("amount, month, year"),
    db.from("children").select("monthly_tuition").eq("is_active", true),
    db.from("payments")
      .select("id, amount, payment_date, payment_method, currency, families(name, father_name)")
      .order("payment_date", { ascending: false })
      .limit(5),
  ]);

  const totalPaid = (paymentsRes.data ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const monthlyTuitionTotal = (monthlyRes.data ?? []).reduce((s, c) => s + Number(c.monthly_tuition), 0);
  // Only count charges up to and including the current month
  const currentMonthKey = currentYear * 100 + currentMonth;
  const totalCharged = (chargesAllRes.data ?? [])
    .filter((c) => Number(c.year) * 100 + Number(c.month) <= currentMonthKey)
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
