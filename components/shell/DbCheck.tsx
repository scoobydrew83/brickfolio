// A plain explanation at the top of every page when the database can't be opened or read, with the fix. Pages that
// need the database fail too, and their error page (app/(app)/error.tsx) offers Retry; this says why. Renders nothing
// when the database is fine. The raw error goes to the server log only.
import { sql } from 'drizzle-orm';
import { connection } from 'next/server';
import { getDb } from '@/lib/db';
import { describeDbError, type DbProblem } from '@/lib/db/errors';
import { DOCS_TROUBLESHOOTING } from '@/lib/brand';

const GENERIC: DbProblem = { kind: 'remote', title: 'The database isn’t answering.', fix: 'Check the server log for the error, then retry.' };

/** The database's state: null when it answers, else what's wrong. Never throws. */
export async function checkDb(): Promise<{ problem: DbProblem; error: unknown } | null> {
  try {
    const db = await getDb();
    await db.run(sql`select 1 from sets limit 1`); // a core table, so missing migrations show up too
    return null;
  } catch (e) {
    return { problem: describeDbError(e) ?? GENERIC, error: e };
  }
}

/** `code` spans in the fixed explanations. */
function Text({ children }: { children: string }) {
  return children.split('`').map((part, i) => (i % 2 ? <code key={i} className="rounded-chip bg-surface px-1">{part}</code> : part));
}

export async function DbCheck() {
  await connection();
  const r = await checkDb();
  if (!r) return null;
  console.error('Database check failed:', r.error);
  return (
    <div role="alert" className="border-b border-danger-ring bg-danger-soft text-danger">
      <div className="mx-auto w-full max-w-7xl space-y-1 px-4 py-3 text-sm sm:px-6">
        <p className="font-semibold">{r.problem.title}</p>
        <p><Text>{r.problem.fix}</Text></p>
        <p>More in <a className="underline" href={DOCS_TROUBLESHOOTING} target="_blank" rel="noreferrer">Troubleshooting</a>. The server log has the full error.</p>
      </div>
    </div>
  );
}
