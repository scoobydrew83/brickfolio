import { Suspense } from 'react';
import { connection } from 'next/server';
import { InsightsView } from '@/components/InsightsView';
import { PageSkeleton } from '@/components/ui';
import { getDb } from '@/lib/db';
import { insights } from '@/lib/insights';
import { getCurrency, listSets } from '@/lib/service/sets';
import { currentCollection, pageBlock } from '@/lib/session';

export const metadata = { title: 'Insights' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton tiles={4} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await connection();
  const blocked = await pageBlock('member'); // #50
  if (blocked) return <p className="py-24 text-center text-fg-3">{blocked}</p>;
  const db = await getDb();
  const scope = await currentCollection();
  const [sets, currency] = await Promise.all([listSets(db, { collectionId: scope }), getCurrency(db)]);
  return <InsightsView data={insights(sets, currency)} currency={currency} />;
}
