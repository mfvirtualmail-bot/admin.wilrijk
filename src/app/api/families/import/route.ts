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

interface ImportChild {
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  monthly_tuition: number;
  notes: string | null;
}

interface ImportFamily {
  name: string;
  father_name: string | null;
  mother_name: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  rijksregister: string | null;
  notes: string | null;
  children: ImportChild[];
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!user.is_super_admin && !perms["families"]?.includes("add"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { families, mode = "skip_existing" } = body as {
    families: ImportFamily[];
    mode?: "skip_existing" | "update_existing";
  };

  if (!Array.isArray(families) || families.length === 0)
    return NextResponse.json({ error: "No family data provided" }, { status: 400 });

  const db = createServerClient();

  // Load existing families for deduplication (case-insensitive by name)
  const { data: existingFamilies } = await db
    .from("families")
    .select("id, name");
  const existingMap = new Map<string, string>(); // lower-name → id
  (existingFamilies ?? []).forEach((f: { id: string; name: string }) => {
    existingMap.set(f.name.toLowerCase().trim(), f.id);
  });

  let createdFamilies = 0;
  let updatedFamilies = 0;
  let createdChildren = 0;
  let skipped = 0;
  const errors: Array<{ row: number; message: string }> = [];

  for (const importFamily of families) {
    const nameKey = importFamily.name.toLowerCase().trim();
    const existingId = existingMap.get(nameKey);

    let familyId: string | null = null;

    if (existingId) {
      if (mode === "skip_existing") {
        skipped++;
        continue;
      } else {
        // Update the existing family
        const { error } = await db
          .from("families")
          .update({
            father_name: importFamily.father_name,
            mother_name: importFamily.mother_name,
            address: importFamily.address,
            city: importFamily.city,
            postal_code: importFamily.postal_code,
            phone: importFamily.phone,
            email: importFamily.email,
            notes: importFamily.rijksregister
              ? `Rijksregister: ${importFamily.rijksregister}${importFamily.notes ? "\n" + importFamily.notes : ""}`
              : importFamily.notes,
          })
          .eq("id", existingId);
        if (error) {
          errors.push({ row: 0, message: `Failed to update ${importFamily.name}: ${error.message}` });
          continue;
        }
        familyId = existingId;
        updatedFamilies++;
      }
    } else {
      // Create new family
      const { data, error } = await db
        .from("families")
        .insert({
          name: importFamily.name,
          father_name: importFamily.father_name,
          mother_name: importFamily.mother_name,
          address: importFamily.address,
          city: importFamily.city,
          postal_code: importFamily.postal_code,
          phone: importFamily.phone,
          email: importFamily.email,
          notes: importFamily.rijksregister
            ? `Rijksregister: ${importFamily.rijksregister}${importFamily.notes ? "\n" + importFamily.notes : ""}`
            : importFamily.notes,
          is_active: true,
        })
        .select("id")
        .single();

      if (error) {
        errors.push({ row: 0, message: `Failed to create ${importFamily.name}: ${error.message}` });
        continue;
      }
      familyId = data.id;
      existingMap.set(nameKey, data.id);
      createdFamilies++;
    }

    // Insert children
    if (importFamily.children.length > 0 && familyId) {
      const fid = familyId;
      const childRows = importFamily.children.map((c) => ({
        family_id: fid,
        first_name: c.first_name,
        last_name: c.last_name,
        date_of_birth: c.date_of_birth,
        monthly_tuition: c.monthly_tuition,
        notes: c.notes,
        is_active: true,
      }));

      const { error } = await db.from("children").insert(childRows);
      if (error) {
        errors.push({ row: 0, message: `Failed to add children for ${importFamily.name}: ${error.message}` });
      } else {
        createdChildren += childRows.length;
      }
    }
  }

  return NextResponse.json({
    created: { families: createdFamilies, children: createdChildren },
    updated: { families: updatedFamilies },
    skipped,
    errors,
  });
}
