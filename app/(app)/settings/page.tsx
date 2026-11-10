import { Suspense } from 'react';
import { PageSkeleton } from '@/components/ui';
import { connection } from 'next/server';
import Settings from '@/components/Settings';
import { authMode } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getCurrency, listLocations } from '@/lib/service/sets';
import { listTokens } from '@/lib/service/tokens';
import { listShareLinks } from '@/lib/service/share';
import { libraryStatus } from '@/lib/ldraw/download';
import { alertsFromEnv } from '@/lib/service/alerts';
import { barcodeCaps, bricklink, brickset, currentUser, rebrickable } from '@/lib/session';
import { barcodeStats } from '@/lib/barcode/resolve';
import { communityStatus } from '@/lib/barcode/community';
import { retailStats } from '@/lib/service/retail';
import { rebrickableStats } from '@/lib/service/catalog';
import { rebrickableRun } from '@/lib/rebrickable/run';
import { cachedUpdateStatus } from '@/lib/service/updates';
import { primarySource, sourceLabel, valueSources } from '@/lib/service/prices';

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
  const [locations, currency, tokens, shares, source, sources] = await Promise.all([listLocations(db), getCurrency(db), listTokens(db), listShareLinks(db), primarySource(db), valueSources(db)]);
  const valueSource = { current: source, options: sources.map((s): [string, string] => [s, sourceLabel(s)]) };
  return <Settings version={await cachedUpdateStatus(db)} locations={locations} currency={currency} valueSource={valueSource} tokens={tokens} shares={shares} user={user.user} authMode={authMode()} priced={!!bricklink()} alerts={!!alertsFromEnv()} rebrickable={{ key: !!rebrickable(), stats: await rebrickableStats(db), run: rebrickableRun() }} brickset={{ key: !!brickset(), stats: await retailStats(db) }} ldraw={await libraryStatus()} barcodes={{ caps: barcodeCaps(), saved: await barcodeStats(db), community: await communityStatus(db) }} />;
}
