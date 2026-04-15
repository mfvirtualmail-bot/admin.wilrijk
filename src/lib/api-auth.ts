import { cookies } from "next/headers";
import { validateSession, getUserPermissions } from "./auth";

/** Shared helper for API routes: returns the authenticated user or null. */
export async function getSessionUser() {
  const token = cookies().get("session")?.value;
  if (!token) return null;
  const r = await validateSession(token);
  return r?.user ?? null;
}

/** Returns true if the user is super admin OR has the given module/action
 * permission. */
export async function hasModuleAction(
  userId: string,
  isSuperAdmin: boolean,
  module: string,
  action: string
): Promise<boolean> {
  if (isSuperAdmin) return true;
  const perms = await getUserPermissions(userId);
  return perms[module]?.includes(action) ?? false;
}
