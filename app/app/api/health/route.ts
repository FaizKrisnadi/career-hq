import { db } from "@/lib/db";

export async function GET() {
  try {
    await db().prepare("SELECT 1").first();
    return Response.json({ ok: true, db: true });
  } catch (e) {
    return Response.json({ ok: false, db: false, error: String(e) }, { status: 500 });
  }
}
