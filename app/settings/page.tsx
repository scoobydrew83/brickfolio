import { Suspense } from 'react';
import { PageSkeleton } from '@/components/ui';
import { connection } from 'next/server';
import Settings from '@/components/Settings';
import { authMode } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getCurrency, listLocations } from '@/lib/service/sets';
import { listTokens } from '@/lib/service/tokens';
import { libraryStatus } from '@/lib/ldraw/download';
import { alertsFromEnv } from '@/lib/service/alerts';
import { bricklink, brickset, currentUser, rebrickable } from '@/lib/session';
import { retailStats } from '@/lib/service/retail';
import { rebrickableStats } from '@/lib/service/catalog';
import { rebrickableRun } from '@/lib/rebrickable/run';

export const metadata = { title: 'Settings' };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Suspense fallback={<PageSkeleton />}>
        <Content />
      </Suspense>
    </div>
  );
}

async function Content() {
  await connection();
  const user = await currentUser();
  if (!user) return <p className="py-24 text-center text-fg-3">Not signed in.</p>;
  const db = await getDb();
  const [locations, currency, tokens] = await Promise.all([listLocations(db), getCurrency(db), listTokens(db)]);
  return <Settings locations={locations} currency={currency} tokens={tokens} user={user.user} authMode={authMode()} priced={!!bricklink()} alerts={!!alertsFromEnv()} rebrickable={{ key: !!rebrickable(), stats: await rebrickableStats(db), run: rebrickableRun() }} brickset={{ key: !!brickset(), stats: await retailStats(db) }} ldraw={await libraryStatus()} />;
}
