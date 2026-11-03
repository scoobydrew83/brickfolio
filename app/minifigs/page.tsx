import { Suspense } from 'react';
import { connection } from 'next/server';
import MinifigsView from '@/components/MinifigsView';
import { PageSkeleton } from '@/components/ui';
import { getDb } from '@/lib/db';
import { cmfSeries, listMinifigs } from '@/lib/service/minifigs';
import { getCurrency, listLocations } from '@/lib/service/sets';
import { brickMinifig, currentUser, rebrickable } from '@/lib/session';

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
  if (!(await currentUser())) return <p className="py-24 text-center text-fg-3">Not signed in.</p>;
  const db = await getDb();
  const [figs, series, locations, currency] = await Promise.all([listMinifigs(db), cmfSeries(db), listLocations(db), getCurrency(db)]);
  return <MinifigsView figs={figs} series={series} locations={locations} currency={currency} priced={!!brickMinifig()} hasRebrickable={!!rebrickable()} />;
}
