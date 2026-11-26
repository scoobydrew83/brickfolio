// Health check for Docker and uptime monitors. No auth; reveals only "ok" and, when the database fails, which kind of
// problem it is (e.g. "locked", "permission"; see lib/db/errors.ts), never the error itself.
import { sql } from 'drizzle-orm';
import { connection } from 'next/server';
import { getDb } from '@/lib/db';
import { describeDbError } from '@/lib/db/errors';

export async function GET() {
  await connection(); // check on every request, never at build time
  try {
    await (await getDb()).run(sql`select 1`);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, problem: describeDbError(e)?.kind ?? 'unknown' }, { status: 503 });
  }
}
