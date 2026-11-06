import { db } from "./db";

export const STATUS_ORDER = [
  "discovered",
  "researching",
  "drafting",
  "ready",
  "applied",
  "interview",
  "offer",
] as const;

export interface AppRow {
  id: number;
  company: string;
  role: string;
  status: string;
  score: number | null;
  url: string | null;
  applied_date: string | null;
  company_key: string | null;
  updated_at: string;
  deadline_at: string | null;
  deadline_verified: number;
  priority: string | null;
}

export async function countsByStatus(): Promise<Record<string, number>> {
  const { results } = await db()
    .prepare("SELECT status, COUNT(*) AS n FROM applications GROUP BY status")
    .all<{ status: string; n: number }>();
  return Object.fromEntries(results.map((r) => [r.status, r.n]));
}

export interface BoardRow extends AppRow {
  days_left: number | null;
}

export async function pipelineBoard(): Promise<Record<string, BoardRow[]>> {
  const { results } = await db()
    .prepare(
      "SELECT a.id, a.company, a.role, a.status, a.score, a.url, a.applied_date, a.company_key, a.updated_at, " +
        "o.deadline_at, o.deadline_verified, o.priority, " +
        "CAST(julianday(substr(o.deadline_at,1,19)) - julianday('now') AS INTEGER) AS days_left " +
        "FROM applications a LEFT JOIN opportunities o ON o.id = a.opportunity_id " +
        "ORDER BY a.updated_at DESC",
    )
    .all<BoardRow>();
  const board: Record<string, BoardRow[]> = {};
  for (const s of [...STATUS_ORDER, "outcome", "rejected", "withdrawn"]) board[s] = [];
  for (const row of results) {
    (board[row.status] ??= []).push(row);
  }
  return board;
}

export interface DeadlineRow extends AppRow {
  days_left: number | null;
}

export async function upcomingDeadlines(): Promise<DeadlineRow[]> {
  const { results } = await db()
    .prepare(
      "SELECT a.id, a.company, a.role, a.status, a.score, a.url, a.applied_date, a.company_key, a.updated_at, " +
        "o.deadline_at, o.deadline_verified, o.priority, " +
        "CAST(julianday(substr(o.deadline_at,1,19)) - julianday('now') AS INTEGER) AS days_left " +
        "FROM applications a JOIN opportunities o ON o.id = a.opportunity_id " +
        "WHERE o.deadline_at IS NOT NULL AND a.status IN ('discovered','researching','drafting','ready') " +
        "ORDER BY o.deadline_at ASC LIMIT 50",
    )
    .all<DeadlineRow>();
  return results;
}

export async function recentTransitions(limit = 10) {
  const { results } = await db()
    .prepare(
      "SELECT s.date, s.from_status, s.to_status, s.source, s.note, a.company, a.role " +
        "FROM status_log s JOIN applications a ON a.id = s.application_id " +
        "ORDER BY s.id DESC LIMIT ?1",
    )
    .bind(limit)
    .all<{ date: string; from_status: string; to_status: string; source: string; note: string | null; company: string; role: string }>();
  return results;
}
