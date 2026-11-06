import { checkEngineAuth } from "@/lib/auth";
import { db } from "@/lib/db";

export function normalizeCompanyKey(company: string): string {
  return company.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Create an application (idempotent per company_key+role or url). */
export async function POST(req: Request) {
  const denied = await checkEngineAuth(req);
  if (denied) return denied;
  let body: {
    company?: string;
    role?: string;
    url?: string;
    applied_date?: string;
    status?: string;
    source?: string;
    notes?: string;
    opportunity_id?: number;
    score?: number;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.company || !body.role) {
    return Response.json({ error: "company and role required" }, { status: 400 });
  }

  const companyKey = normalizeCompanyKey(body.company);
  let existing: { id: number } | null = null;
  if (body.url) {
    existing = await db()
      .prepare("SELECT id FROM applications WHERE url = ?1")
      .bind(body.url)
      .first<{ id: number }>();
  }
  if (!existing) {
    existing = await db()
      .prepare("SELECT id FROM applications WHERE company_key IS ?1 AND role = ?2")
      .bind(companyKey, body.role)
      .first<{ id: number }>();
  }
  if (existing) {
    return Response.json({ application: existing, deduped: true });
  }

  const row = await db()
    .prepare(
      "INSERT INTO applications (opportunity_id, applied_date, company, role, score, status, notes, url, company_key) " +
        "VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9) RETURNING *",
    )
    .bind(
      body.opportunity_id ?? null,
      body.applied_date ?? null,
      body.company,
      body.role,
      body.score ?? null,
      body.status ?? "applied",
      body.notes ?? null,
      body.url ?? null,
      companyKey,
    )
    .first();
  return Response.json({ application: row, deduped: false }, { status: 201 });
}
