import { checkEngineAuth } from "@/lib/auth";
import { completeTask, logEngineEvent } from "@/lib/db";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await checkEngineAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  let body: { result?: unknown; error?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const task = await completeTask(Number(id), body);
  if (!task) return Response.json({ error: "task not claimed" }, { status: 409 });
  await logEngineEvent(task.id, body.error ? "failed" : "completed", body.error ?? body.result);
  return Response.json({ task });
}
