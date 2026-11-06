import { checkEngineAuth } from "@/lib/auth";
import { db } from "@/lib/db";

/** Record a fit analysis (score + evidence classes + gaps). */
export async function POST(req: Request) {
  const denied = await checkEngineAuth(req);
  if (denied) return denied;
  let body: {
    opportunity_id?: number;
    application_id?: number;
    score?: number;
    summary?: string;
    evidence?: unknown;
    gaps?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.opportunity_id && !body.application_id) {
    return Response.json({ error: "opportunity_id or application_id required" }, { status: 400 });
  }
  const row = await db()
    .prepare(
      "INSERT INTO fit_analyses (opportunity_id, application_id, score, summary, evidence_json, gaps_json) " +
        "VALUES (?1,?2,?3,?4,?5,?6) RETURNING *",
    )
    .bind(
      body.opportunity_id ?? null,
      body.application_id ?? null,
      body.score ?? null,
      body.summary ?? null,
      body.evidence !== undefined ? JSON.stringify(body.evidence) : null,
      body.gaps !== undefined ? JSON.stringify(body.gaps) : null,
    )
    .first();
  return Response.json({ fit: row }, { status: 201 });
}
