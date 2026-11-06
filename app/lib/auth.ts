import { getEnv } from "./env";

async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Timing-safe bearer check. Returns a 401 Response, or null when authorized. */
export async function checkEngineAuth(req: Request): Promise<Response | null> {
  const expected = getEnv().ENGINE_API_KEY;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!expected || !token) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const [a, b] = await Promise.all([sha256hex(expected), sha256hex(token)]);
  if (a !== b) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
