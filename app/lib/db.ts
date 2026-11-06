import { getEnv } from "./env";

export type TaskKind =
  | "intake"
  | "fit"
  | "tailor_cv"
  | "cover_letter"
  | "interview_prep"
  | "sweep"
  | "writeback"
  | "export"
  | "import_parse";

export type AppStatus =
  | "discovered"
  | "researching"
  | "drafting"
  | "ready"
  | "applied"
  | "interview"
  | "offer"
  | "outcome"
  | "rejected"
  | "withdrawn";

export interface Task {
  id: number;
  kind: TaskKind;
  payload_json: string;
  status: "pending" | "claimed" | "done" | "failed";
  claimed_at: string | null;
  finished_at: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
}

const VALID_STATUSES: ReadonlySet<AppStatus> = new Set([
  "discovered",
  "researching",
  "drafting",
  "ready",
  "applied",
  "interview",
  "offer",
  "outcome",
  "rejected",
  "withdrawn",
]);

export function db() {
  return getEnv().DB;
}

export async function listTasks(status?: string): Promise<Task[]> {
  const stmt =
    status !== undefined
      ? db().prepare("SELECT * FROM tasks WHERE status = ? ORDER BY id ASC LIMIT 200").bind(status)
      : db().prepare("SELECT * FROM tasks ORDER BY id ASC LIMIT 200");
  const { results } = await stmt.all<Task>();
  return results;
}

export async function createTask(kind: TaskKind, payload: unknown): Promise<Task> {
  const payloadJson = JSON.stringify(payload ?? {});
  const res = await db()
    .prepare("INSERT INTO tasks (kind, payload_json) VALUES (?1, ?2) RETURNING *")
    .bind(kind, payloadJson)
    .first<Task>();
  if (!res) throw new Error("task insert failed");
  return res;
}

export async function claimTask(id: number): Promise<Task | null> {
  return db()
    .prepare(
      "UPDATE tasks SET status = 'claimed', claimed_at = datetime('now') " +
        "WHERE id = ?1 AND status = 'pending' RETURNING *",
    )
    .bind(id)
    .first<Task>();
}

export async function completeTask(
  id: number,
  opts: { result?: unknown; error?: string },
): Promise<Task | null> {
  const resultJson = opts.result !== undefined ? JSON.stringify(opts.result) : null;
  const status = opts.error ? "failed" : "done";
  return db()
    .prepare(
      "UPDATE tasks SET status = ?2, result_json = ?3, error = ?4, finished_at = datetime('now') " +
        "WHERE id = ?1 AND status = 'claimed' RETURNING *",
    )
    .bind(id, status, resultJson, opts.error ?? null)
    .first<Task>();
}

/**
 * Append-only status transition (career-ops status-log.tsv semantics):
 * from '-' when no prior state exists; updates the application row; queues a
 * write-back task so the Atlas mirror follows the dashboard.
 */
export async function transitionStatus(
  applicationId: number,
  toStatus: string,
  source: string,
  note?: string,
): Promise<{ application: Record<string, unknown>; transition: Record<string, unknown> } | null> {
  if (!VALID_STATUSES.has(toStatus as AppStatus)) {
    throw new Error(`invalid status: ${toStatus}`);
  }
  const app = await db()
    .prepare("SELECT id, status FROM applications WHERE id = ?1")
    .bind(applicationId)
    .first<{ id: number; status: string }>();
  if (!app) return null;

  const from = app.status ?? "-";
  await db()
    .prepare(
      "INSERT INTO status_log (application_id, date, from_status, to_status, source, note) " +
        "VALUES (?1, datetime('now'), ?2, ?3, ?4, ?5)",
    )
    .bind(applicationId, from, toStatus, source, note ?? null)
    .run();
  const updated = await db()
    .prepare("UPDATE applications SET status = ?2, updated_at = datetime('now') WHERE id = ?1 RETURNING *")
    .bind(applicationId, toStatus)
    .first<Record<string, unknown>>();
  if (!updated) return null;

  await createTask("writeback", {
    type: "status_change",
    application_id: applicationId,
    from,
    to: toStatus,
    note: note ?? null,
  });
  return { application: updated, transition: { from, to: toStatus, source, note: note ?? null } };
}

export async function logEngineEvent(
  taskId: number | null,
  event: string,
  detail?: unknown,
): Promise<void> {
  await db()
    .prepare("INSERT INTO engine_log (task_id, event, detail_json) VALUES (?1, ?2, ?3)")
    .bind(taskId, event, detail !== undefined ? JSON.stringify(detail) : null)
    .run();
}
