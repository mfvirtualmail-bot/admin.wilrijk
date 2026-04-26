import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { validateSession } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import {
  academicYearFromHebrew,
  currentAcademicYear,
  earliestHebrewYearFromGregorian,
  listAcademicYears,
} from "@/lib/academic-year";

export const dynamic = "force-dynamic";

/**
 * List every Hebrew academic year that has activity in the system, from
 * the earliest enrollment_start_year up to and including the current
 * year. Newest first.
 *
 * Used by the shared <AcademicYearSelector> and by any page that needs
 * to populate its own year dropdown.
 */
export async function GET() {
  const token = cookies().get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await validateSession(token);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServerClient();

  // Pick the earliest enrollment_start_year from children. Fall back to
  // the current academic year if nothing has ever been enrolled.
  const { data: earliestRow } = await db
    .from("children")
    .select("enrollment_start_year")
    .not("enrollment_start_year", "is", null)
    .order("enrollment_start_year", { ascending: true })
    .limit(1);

  const cur = currentAcademicYear();
  let earliestHebrew = cur.hebrewYear;
  const earliestGreg = earliestRow?.[0]?.enrollment_start_year;
  if (typeof earliestGreg === "number" && earliestGreg > 1900) {
    earliestHebrew = earliestHebrewYearFromGregorian(earliestGreg);
  }

  const years = listAcademicYears(earliestHebrew);
  return NextResponse.json({
    years,
    current: academicYearFromHebrew(cur.hebrewYear),
  });
}
