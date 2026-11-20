import { Suspense } from 'react';
import { connection } from 'next/server';
import { sql } from 'drizzle-orm';
import BuildView from '@/components/BuildView';
import { PageSkeleton } from '@/components/ui';
import { getDb } from '@/lib/db';
import { partLots, setParts } from '@/lib/db/schema';
import { buildMatches } from '@/lib/service/builds';
import { currentCollection, rebrickable, pageBlock } from '@/lib/session';

export const metadata = { title: 'What can I build?' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton tiles={2} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const scope = await currentCollection();
  await connection();
  const blocked = await pageBlock('member'); // #50
  if (blocked) return <p className="py-24 text-center text-fg-3">{blocked}</p>;
  const db = await getDb();
  const [matches, [{ n }], [{ lots }]] = await Promise.all([
    buildMatches(db, { collectionId: scope }),
    db.select({ n: sql<number>`count(*)` }).from(setParts).all(),
    db.select({ lots: sql<number>`count(*)` }).from(partLots).all(),
  ]);
  return <BuildView builds={matches} hasKey={!!rebrickable()} hasParts={Number(n) > 0} hasLots={Number(lots) > 0} collection={typeof scope === 'number' ? scope : undefined} />;
}
