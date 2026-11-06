import { checkEngineAuth } from "@/lib/auth";
import { db } from "@/lib/db";

const KINDS = new Set(["cv", "cover_letter", "interview_prep", "followup", "report", "other"]);
const LANGS = new Set(["en", "id"]);

/** Push a generated document (text + lint results). Binaries go to R2 later; r2_key may be null. */
export async function POST(req: Request) {
  const denied = await checkEngineAuth(req);
  if (denied) return denied;
  let body: {
    application_id?: number;
    kind?: string;
    language?: string;
    title?: string;
    text_content?: string;
    r2_key?: string;
    lint?: unknown;
    meta?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.kind || !KINDS.has(body.kind)) {
    return Response.json({ error: "invalid kind" }, { status: 400 });
  }
  const language = body.language ?? "en";
  if (!LANGS.has(language)) return Response.json({ error: "invalid language" }, { status: 400 });
  if (!body.text_content) return Response.json({ error: "text_content required" }, { status: 400 });

  const doc = await db()
    .prepare(
      "INSERT INTO documents (application_id, kind, language, title, text_content, r2_key, meta_json) " +
        "VALUES (?1,?2,?3,?4,?5,?6,?7) RETURNING *",
    )
    .bind(
      body.application_id ?? null,
      body.kind,
      language,
      body.title ?? null,
      body.text_content,
      body.r2_key ?? null,
      body.meta ? JSON.stringify(body.meta) : null,
    )
    .first<Record<string, unknown>>();
  if (!doc) return Response.json({ error: "insert failed" }, { status: 500 });

  await db()
    .prepare("INSERT INTO doc_versions (document_id, version, text_content, r2_key, lint_json) " +
      "VALUES (?1, 1, ?2, ?3, ?4)")
    .bind(doc.id, body.text_content, body.r2_key ?? null, body.lint ? JSON.stringify(body.lint) : null)
    .run();

  return Response.json({ document: doc }, { status: 201 });
}
