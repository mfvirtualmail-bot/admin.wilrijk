import { createServerClient } from "./supabase";
import crypto from "crypto";

const ITERATIONS = 100_000;
const KEY_LENGTH = 64;
const DIGEST = "sha512";

export function generateSalt(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function hashPassword(
  password: string,
  salt: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, DIGEST, (err, key) => {
      if (err) reject(err);
      else resolve(key.toString("hex"));
    });
  });
}

export async function verifyPassword(
  password: string,
  salt: string,
  storedHash: string
): Promise<boolean> {
  const hash = await hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(storedHash, "hex"));
}

export function generateSessionToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export async function createSession(userId: string): Promise<string> {
  const db = createServerClient();
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.from("sessions").insert({
    user_id: userId,
    token,
    expires_at: expiresAt.toISOString(),
  });

  return token;
}

export async function validateSession(token: string) {
  const db = createServerClient();

  const { data: session } = await db
    .from("sessions")
    .select("*, users(*)")
    .eq("token", token)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (!session) return null;

  return {
    session,
    user: session.users as {
      id: string;
      username: string;
      display_name: string;
      language: string;
      is_super_admin: boolean;
    },
  };
}

export async function deleteSession(token: string) {
  const db = createServerClient();
  await db.from("sessions").delete().eq("token", token);
}

export async function getUserPermissions(userId: string) {
  const db = createServerClient();

  const { data } = await db
    .from("user_permissions")
    .select("module, action")
    .eq("user_id", userId);

  const permissions: Record<string, string[]> = {};
  for (const row of data || []) {
    if (!permissions[row.module]) permissions[row.module] = [];
    permissions[row.module].push(row.action);
  }
  return permissions;
}

export function hasPermission(
  permissions: Record<string, string[]>,
  module: string,
  action: string
): boolean {
  return permissions[module]?.includes(action) ?? false;
}

// Create the initial super admin user (for first-time setup)
export async function createInitialAdmin(
  username: string,
  password: string,
  displayName: string
) {
  const db = createServerClient();
  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);

  const { data, error } = await db
    .from("users")
    .insert({
      username,
      password_hash: passwordHash,
      salt,
      display_name: displayName,
      language: "en",
      is_super_admin: true,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}
