import { checkEngineAuth } from "@/lib/auth";
import { db } from "@/lib/db";

function normalizeCompanyKey(company: string): string {
  return company.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const LIVENESS = new Set(["live", "closed", "uncertain", "evergreen"]);

/**
 * Push a sweep candidate into the inbox. Dedup order: simhash match in
 * candidates → simhash match in opportunities (already tracked) →
 * company_key+role in opportunities. Duplicates return the existing row
 * with deduped: true and are not re-inserted.
 */
export async function POST(req: Request) {
  const denied = await checkEngineAuth(req);
  if (denied) return denied;
  let body: {
    company?: string;
    role?: string;
    location?: string;
    url?: string;
    source?: string;
    deadline_at?: string;
    simhash?: string;
    company_key?: string;
    trust_score?: number;
    trust_flags?: string;
    liveness?: string;
    fit_score?: number;
    fit_summary?: string;
    raw_json?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.company || !body.role) {
    return Response.json({ error: "company and role required" }, { status: 400 });
  }
  const liveness = body.liveness && LIVENESS.has(body.liveness) ? body.liveness : "uncertain";

  if (body.simhash) {
    const c = await db()
      .prepare("SELECT id FROM candidates WHERE simhash = ?1")
      .bind(body.simhash)
      .first<{ id: number }>();
    if (c) return Response.json({ candidate: c, deduped: true, reason: "candidate-exists" });
    const o = await db()
      .prepare("SELECT id FROM opportunities WHERE simhash = ?1")
      .bind(body.simhash)
      .first<{ id: number }>();
    if (o) return Response.json({ opportunity: o, deduped: true, reason: "already-tracked" });
  }
  const companyKey = body.company_key ?? normalizeCompanyKey(body.company);
  const o2 = await db()
    .prepare("SELECT id FROM opportunities WHERE company_key = ?1 AND role = ?2")
    .bind(companyKey, body.role)
    .first<{ id: number }>();
  if (o2) return Response.json({ opportunity: o2, deduped: true, reason: "already-tracked" });

  const row = await db()
    .prepare(
      "INSERT INTO candidates (company, role, location, url, source, deadline_at, simhash, company_key, " +
        "trust_score, trust_flags, liveness, fit_score, fit_summary, raw_json) " +
        "VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14) RETURNING *",
    )
    .bind(
      body.company,
      body.role,
      body.location ?? null,
      body.url ?? null,
      body.source ?? "sweep",
      body.deadline_at ?? null,
      body.simhash ?? null,
      companyKey,
      body.trust_score ?? null,
      body.trust_flags ?? null,
      liveness,
      body.fit_score ?? null,
      body.fit_summary ?? null,
      body.raw_json ?? null,
    )
    .first();
  return Response.json({ candidate: row, deduped: false }, { status: 201 });
}
