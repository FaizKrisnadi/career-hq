import { SESSION_COOKIE, sessionHash } from "@/lib/session";

export async function POST(req: Request) {
  let body: { key?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const expected = await sessionHash();
  if (!expected || !body.key || (await sha(body.key)) !== expected) {
    return Response.json({ error: "invalid key" }, { status: 401 });
  }
  const res = Response.json({ ok: true });
  res.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${expected}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
  );
  return res;
}

async function sha(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
