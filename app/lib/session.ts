import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getEnv } from "./env";

export const SESSION_COOKIE = "hq_session";

export async function sessionHash(): Promise<string | null> {
  const key = getEnv().ENGINE_API_KEY;
  if (!key) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function isAuthenticated(): Promise<boolean> {
  const [cookie, expected] = await Promise.all([cookies(), sessionHash()]);
  if (!expected) return false;
  return cookie.get(SESSION_COOKIE)?.value === expected;
}

export async function requireSession(): Promise<void> {
  if (!(await isAuthenticated())) redirect("/login");
}
