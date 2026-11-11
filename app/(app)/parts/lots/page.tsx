import { Suspense } from 'react';
import { connection } from 'next/server';
import LotsView from '@/components/LotsView';
import { PageSkeleton } from '@/components/ui';
import { getDb } from '@/lib/db';
import { listImports, listLots } from '@/lib/service/lots';
import { ensureColors } from '@/lib/service/parts';
import { listLocations } from '@/lib/service/sets';
import { brickColors, currentUser } from '@/lib/session';

export const metadata = { title: 'Loose parts' };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <Suspense fallback={<PageSkeleton />}>
        <Content />
      </Suspense>
    </div>
  );
}

async function Content() {
  await connection();
  if (!(await currentUser())) return <p className="py-24 text-center text-fg-3">Not signed in.</p>;
  const db = await getDb();
  await ensureColors(db, brickColors());
  const [first, locations, imports] = await Promise.all([listLots(db, { limit: 200 }), listLocations(db), listImports(db)]);
  return <LotsView first={first} locations={locations} imports={imports} />;
}
