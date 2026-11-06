import { checkEngineAuth } from "@/lib/auth";
import { db } from "@/lib/db";

const KINDS = new Set(["job", "fellowship", "publication", "phd", "program", "event", "other"]);
const SOURCES = new Set(["linkedin-export", "muse", "chrome-audit", "manual", "sweep", "import"]);
const LIVENESS = new Set(["live", "closed", "uncertain", "evergreen"]);

/**
 * Upsert an opportunity. Dedup order: explicit id → simhash match →
 * normalized company key + role match. Sweep results should always carry a
 * simhash so reposts collapse into the same row.
 */
export async function POST(req: Request) {
  const denied = await checkEngineAuth(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.kind && !KINDS.has(String(body.kind))) {
    return Response.json({ error: "invalid kind" }, { status: 400 });
  }
  if (body.source && !SOURCES.has(String(body.source))) {
    return Response.json({ error: "invalid source" }, { status: 400 });
  }
  if (body.liveness && !LIVENESS.has(String(body.liveness))) {
    return Response.json({ error: "invalid liveness" }, { status: 400 });
  }

  const simhash = body.simhash ? String(body.simhash) : null;
  const companyKey = body.company_key ? String(body.company_key) : null;
  const role = body.role ? String(body.role) : null;

  let existing: { id: number } | null = null;
  if (body.id) {
    existing = await db()
      .prepare("SELECT id FROM opportunities WHERE id = ?1")
      .bind(Number(body.id))
      .first<{ id: number }>();
  } else if (simhash) {
    existing = await db()
      .prepare("SELECT id FROM opportunities WHERE simhash = ?1")
      .bind(simhash)
      .first<{ id: number }>();
  } else if (companyKey && role) {
    existing = await db()
      .prepare("SELECT id FROM opportunities WHERE company_key = ?1 AND role = ?2")
      .bind(companyKey, role)
      .first<{ id: number }>();
  }

  const cols = {
    kind: (body.kind as string) ?? "job",
    company: body.company ?? null,
    role,
    location: body.location ?? null,
    url: body.url ?? null,
    source: (body.source as string) ?? "manual",
    description: body.description ?? null,
    deadline_at: body.deadline_at ?? null,
    deadline_tz: body.deadline_tz ?? null,
    deadline_verified: body.deadline_verified ? 1 : 0,
    liveness: (body.liveness as string) ?? "uncertain",
    priority: body.priority ?? null,
    simhash,
    company_key: companyKey,
    posting_date: body.posting_date ?? null,
    trust_score: body.trust_score ?? null,
    trust_flags: body.trust_flags ?? null,
    verification_note: body.verification_note ?? null,
    notes: body.notes ?? null,
  };

  if (existing) {
    await db()
      .prepare(
        "UPDATE opportunities SET kind=?2, company=?3, role=?4, location=?5, url=?6, source=?7, " +
          "description=?8, deadline_at=?9, deadline_tz=?10, deadline_verified=?11, liveness=?12, " +
          "priority=?13, simhash=?14, company_key=?15, posting_date=?16, trust_score=?17, " +
          "trust_flags=?18, verification_note=?19, notes=?20, updated_at=datetime('now') WHERE id=?1",
      )
      .bind(
        existing.id,
        cols.kind,
        cols.company,
        cols.role,
        cols.location,
        cols.url,
        cols.source,
        cols.description,
        cols.deadline_at,
        cols.deadline_tz,
        cols.deadline_verified,
        cols.liveness,
        cols.priority,
        cols.simhash,
        cols.company_key,
        cols.posting_date,
        cols.trust_score,
        cols.trust_flags,
        cols.verification_note,
        cols.notes,
      )
      .run();
    const row = await db()
      .prepare("SELECT * FROM opportunities WHERE id = ?1")
      .bind(existing.id)
      .first();
    return Response.json({ opportunity: row, deduped: true });
  }

  const row = await db()
    .prepare(
      "INSERT INTO opportunities (kind, company, role, location, url, source, description, " +
        "deadline_at, deadline_tz, deadline_verified, liveness, priority, simhash, company_key, " +
        "posting_date, trust_score, trust_flags, verification_note, notes) " +
        "VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19) RETURNING *",
    )
    .bind(
      cols.kind,
      cols.company,
      cols.role,
      cols.location,
      cols.url,
      cols.source,
      cols.description,
      cols.deadline_at,
      cols.deadline_tz,
      cols.deadline_verified,
      cols.liveness,
      cols.priority,
      cols.simhash,
      cols.company_key,
      cols.posting_date,
      cols.trust_score,
      cols.trust_flags,
      cols.verification_note,
      cols.notes,
    )
    .first();
  return Response.json({ opportunity: row, deduped: false }, { status: 201 });
}
