import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { createInitialAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/setup — check if setup is needed
 * POST /api/auth/setup — create initial admin user
 *
 * Only works when no users exist in the database.
 */
export async function GET() {
  try {
    const db = createServerClient();
    const { count, error } = await db
      .from("users")
      .select("id", { count: "exact", head: true });

    if (error) {
      return NextResponse.json(
        { error: `Database error: ${error.message}. Have you run schema.sql in Supabase SQL Editor?` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      needsSetup: (count ?? 0) === 0,
      userCount: count ?? 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = createServerClient();

    // Only allow setup when no users exist
    const { count } = await db
      .from("users")
      .select("id", { count: "exact", head: true });

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: "Setup already completed. Users already exist in the database." },
        { status: 403 }
      );
    }

    const { username, password, displayName } = await request.json();
    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    const user = await createInitialAdmin(
      username,
      password,
      displayName || username
    );

    return NextResponse.json({
      message: "Admin user created successfully. You can now log in.",
      user: { id: user.id, username: user.username },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
