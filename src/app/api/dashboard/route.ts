import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { elapsedAcademicMonths } from "@/lib/hebrew-date";

function getAcademicYear(date = new Date()) {
  const m = date.getMonth() + 1;
  return m >= 9 ? date.getFullYear() : date.getFullYear() - 1;
}

export async function GET() {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await validateSession(token);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServerClient();

  const [familiesRes, childrenRes, paymentsRes, chargesRes, recentPaymentsRes] = await Promise.all([
    db.from("families").select("id", { count: "exact" }).eq("is_active", true),
    db.from("children").select("id", { count: "exact" }).eq("is_active", true),
    db.from("payments").select("amount"),
    db.from("children").select("monthly_tuition").eq("is_active", true),
    db.from("payments")
      .select("id, amount, payment_date, payment_method, currency, families(name, father_name)")
      .order("payment_date", { ascending: false })
      .limit(5),
  ]);

  const totalPaid = (paymentsRes.data ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const monthlyTuitionTotal = (chargesRes.data ?? []).reduce((s, c) => s + Number(c.monthly_tuition), 0);
  // Only multiply by months that have already started this Hebrew academic year
  const elapsed = elapsedAcademicMonths(getAcademicYear());
  const totalCharged = monthlyTuitionTotal * elapsed;
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
