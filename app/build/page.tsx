import { Suspense } from 'react';
import { connection } from 'next/server';
import { sql } from 'drizzle-orm';
import BuildView from '@/components/BuildView';
import { PageSkeleton } from '@/components/ui';
import { getDb } from '@/lib/db';
import { setParts } from '@/lib/db/schema';
import { buildMatches } from '@/lib/service/builds';
import { currentUser, rebrickable } from '@/lib/session';

export const metadata = { title: 'What can I build?' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton tiles={2} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await connection();
  if (!(await currentUser())) return <p className="py-24 text-center text-fg-3">Not signed in.</p>;
  const db = await getDb();
  const [matches, [{ n }]] = await Promise.all([buildMatches(db), db.select({ n: sql<number>`count(*)` }).from(setParts).all()]);
  return <BuildView builds={matches} hasKey={!!rebrickable()} hasParts={Number(n) > 0} />;
}
