import { NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getSessionUser, hasModuleAction } from "@/lib/api-auth";
import { buildFamilyStatement } from "@/lib/statement-data";
import { getEmailSettings } from "@/lib/email-send";
import { renderStatementPdf } from "@/lib/pdf-statement";

// PDF generation uses Node APIs (path, fs) so force Node runtime, not Edge.
export const runtime = "nodejs";

/** Streams the PDF statement for a single family. Used by the preview pane
 * (opens in an <iframe>) and by the per-family download button. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!(await hasModuleAction(user.id, user.is_super_admin, "email", "send")))
    return new Response("Forbidden", { status: 403 });

  const familyId = req.nextUrl.searchParams.get("familyId");
  if (!familyId) return new Response("familyId required", { status: 400 });

  const db = createServerClient();
  const data = await buildFamilyStatement(db, familyId);
  if (!data) return new Response("Family not found", { status: 404 });

  const settings = await getEmailSettings(db);
  if (!settings) return new Response("Email settings not configured", { status: 500 });

  try {
    const pdf = await renderStatementPdf(data, settings);
    const filename = `statement-${data.family.name.replace(/[^a-z0-9]+/gi, "_")}-${data.statementDate}.pdf`;
    // Cast via Uint8Array to satisfy the Fetch Response BodyInit type in
    // Next.js' runtime (Node Buffer is a subclass but TS narrows it out).
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : "PDF render failed";
    return new Response(`PDF error: ${err}`, { status: 500 });
  }
}
