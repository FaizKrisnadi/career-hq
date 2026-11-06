import { checkEngineAuth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Profile pointers for the engine. The engine runs on the same machine as the
 * source files, so this returns paths + settings rather than file contents.
 * Paths are read from the `settings` table (keys prefixed `src.`) so no
 * machine-specific paths live in the repo. Seed with:
 *   INSERT INTO settings (key, value) VALUES ('src.cv', '/absolute/path');
 */
export async function GET(req: Request) {
  const denied = await checkEngineAuth(req);
  if (denied) return denied;
  const { results } = await db().prepare("SELECT key, value FROM settings WHERE key LIKE 'src.%'").all<{
    key: string;
    value: string;
  }>();
  const sources = Object.fromEntries(results.map((r) => [r.key.slice(4), r.value]));
  return Response.json({ sources, settings: undefined });
}
