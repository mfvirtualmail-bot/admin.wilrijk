import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getSessionUser, hasModuleAction } from "@/lib/api-auth";
import { buildFamilyStatement } from "@/lib/statement-data";

/** JSON view of the same statement data that powers the PDF / email preview.
 *  Used by the inline "Full statement" toggle on the family detail page. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasModuleAction(user.id, user.is_super_admin, "families", "view")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createServerClient();
  const data = await buildFamilyStatement(db, params.id);
  if (!data) return NextResponse.json({ error: "Family not found" }, { status: 404 });

  return NextResponse.json({
    currency: data.currency,
    rows: data.rows,
    credit: data.credit,
    totalCharged: data.totalCharged,
    totalPaid: data.totalPaid,
    balanceDue: data.balanceDue,
    statementDate: data.statementDate,
  });
}
