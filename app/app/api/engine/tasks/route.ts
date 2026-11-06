import { checkEngineAuth } from "@/lib/auth";
import { createTask, listTasks, type TaskKind } from "@/lib/db";

const TASK_KINDS: ReadonlySet<string> = new Set([
  "intake",
  "fit",
  "tailor_cv",
  "cover_letter",
  "interview_prep",
  "sweep",
  "writeback",
  "export",
  "import_parse",
]);

export async function GET(req: Request) {
  const denied = await checkEngineAuth(req);
  if (denied) return denied;
  const status = new URL(req.url).searchParams.get("status") ?? undefined;
  return Response.json({ tasks: await listTasks(status) });
}

export async function POST(req: Request) {
  const denied = await checkEngineAuth(req);
  if (denied) return denied;
  let body: { kind?: string; payload?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.kind || !TASK_KINDS.has(body.kind)) {
    return Response.json({ error: "unknown task kind" }, { status: 400 });
  }
  const task = await createTask(body.kind as TaskKind, body.payload);
  return Response.json({ task }, { status: 201 });
}
