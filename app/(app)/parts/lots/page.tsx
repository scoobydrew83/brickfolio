import { Suspense } from 'react';
import { connection } from 'next/server';
import LotsView from '@/components/LotsView';
import { PageSkeleton } from '@/components/ui';
import { getDb } from '@/lib/db';
import { listImports, listLots } from '@/lib/service/lots';
import { ensureColors, listColors } from '@/lib/service/parts';
import { listLocations } from '@/lib/service/sets';
import { brickColors, pageBlock } from '@/lib/session';

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
  const blocked = await pageBlock('member'); // #50
  if (blocked) return <p className="py-24 text-center text-fg-3">{blocked}</p>;
  const db = await getDb();
  await ensureColors(db, brickColors());
  const [first, locations, imports, colors] = await Promise.all([listLots(db, { limit: 200 }), listLocations(db), listImports(db), listColors(db)]);
  return <LotsView first={first} locations={locations} imports={imports} colors={colors} />;
}
