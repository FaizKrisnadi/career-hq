import { checkEngineAuth } from "@/lib/auth";
import { claimTask, logEngineEvent } from "@/lib/db";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await checkEngineAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const task = await claimTask(Number(id));
  if (!task) return Response.json({ error: "task not pending" }, { status: 409 });
  await logEngineEvent(task.id, "claimed");
  return Response.json({ task });
}
