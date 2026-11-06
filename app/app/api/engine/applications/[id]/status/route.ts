import { checkEngineAuth } from "@/lib/auth";
import { transitionStatus } from "@/lib/db";

const SOURCES = new Set(["manual", "engine", "import", "sweep", "sync", "correction"]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await checkEngineAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  let body: { status?: string; source?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.status) return Response.json({ error: "status required" }, { status: 400 });
  const source = body.source ?? "engine";
  if (!SOURCES.has(source)) return Response.json({ error: "invalid source" }, { status: 400 });

  try {
    const result = await transitionStatus(Number(id), body.status, source, body.note);
    if (!result) return Response.json({ error: "application not found" }, { status: 404 });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 400 });
  }
}
