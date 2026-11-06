import { checkEngineAuth } from "@/lib/auth";
import { db } from "@/lib/db";

/** Engine reports the outcome of an Atlas write-back queued by a status change. */
export async function POST(req: Request) {
  const denied = await checkEngineAuth(req);
  if (denied) return denied;
  let body: {
    application_id?: number;
    target_file?: string;
    action?: string;
    diff_summary?: string;
    status?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.target_file || !body.action) {
    return Response.json({ error: "target_file and action required" }, { status: 400 });
  }
  const status = body.status ?? "done";
  if (!["pending", "done", "failed"].includes(status)) {
    return Response.json({ error: "invalid status" }, { status: 400 });
  }
  const row = await db()
    .prepare(
      "INSERT INTO sync_log (application_id, target_file, action, diff_summary, status) " +
        "VALUES (?1,?2,?3,?4,?5) RETURNING *",
    )
    .bind(
      body.application_id ?? null,
      body.target_file,
      body.action,
      body.diff_summary ?? null,
      status,
    )
    .first();
  return Response.json({ sync: row }, { status: 201 });
}
