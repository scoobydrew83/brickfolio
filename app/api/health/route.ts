// Health check for Docker and uptime monitors. No auth; reveals nothing but "ok".
import { sql } from 'drizzle-orm';
import { connection } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  await connection(); // check on every request, never at build time
  try {
    await (await getDb()).run(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
