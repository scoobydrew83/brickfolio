import { Suspense } from 'react';
import { connection } from 'next/server';
import MinifigsView from '@/components/MinifigsView';
import { listCollections } from '@/lib/service/collections';
import { writable } from '@/lib/service/permissions';
import { PageSkeleton } from '@/components/ui';
import { getDb } from '@/lib/db';
import { cmfSeries, listMinifigs } from '@/lib/service/minifigs';
import { getCurrency, listLocations } from '@/lib/service/sets';
import { brickMinifig, currentCollection, rebrickable, pageBlock, currentAccess } from '@/lib/session';

export const metadata = { title: 'Minifigures' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton tiles={2} />}>
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
  const access = (await currentAccess())!;
  const collections = await listCollections(db);
  const [figs, series, locations, currency] = await Promise.all([listMinifigs(db, { collectionId: scope }), cmfSeries(db), listLocations(db), getCurrency(db)]);
  return <MinifigsView figs={figs} series={series} locations={locations} currency={currency} priced={!!brickMinifig()} hasRebrickable={!!rebrickable()} collections={collections.filter((c) => access.admin || access.roles.has(c.id))} collection={typeof scope === 'number' ? scope : undefined} writable={writable(access)} />;
}
