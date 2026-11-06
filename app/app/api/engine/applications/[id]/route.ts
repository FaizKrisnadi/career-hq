import { checkEngineAuth } from "@/lib/auth";
import { db } from "@/lib/db";

/** Read one application with its linked opportunity and latest posting. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await checkEngineAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const application = await db()
    .prepare("SELECT * FROM applications WHERE id = ?1")
    .bind(Number(id))
    .first<Record<string, unknown>>();
  if (!application) return Response.json({ error: "not found" }, { status: 404 });

  const opportunity = application.opportunity_id
    ? await db()
        .prepare("SELECT * FROM opportunities WHERE id = ?1")
        .bind(application.opportunity_id)
        .first()
    : null;

  const posting = await db()
    .prepare(
      "SELECT * FROM postings WHERE application_id = ?1 OR opportunity_id = ?2 " +
        "ORDER BY fetched_at DESC LIMIT 1",
    )
    .bind(Number(id), application.opportunity_id ?? -1)
    .first();

  return Response.json({ application, opportunity, posting });
}
