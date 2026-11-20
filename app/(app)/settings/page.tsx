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
import { barcodeCaps, bricklink, brickset, currentUser, rebrickable, currentAccess } from '@/lib/session';
import { barcodeStats } from '@/lib/barcode/resolve';
import { communityStatus } from '@/lib/barcode/community';
import { retailStats } from '@/lib/service/retail';
import { rebrickableStats } from '@/lib/service/catalog';
import { rebrickableRun } from '@/lib/rebrickable/run';
import { cachedUpdateStatus } from '@/lib/service/updates';
import { primarySource, sourceLabel, valueSources } from '@/lib/service/prices';

import { collectionCounts, listCollections } from '@/lib/service/collections';
import { adminList, listPeople, membersOf } from '@/lib/service/permissions';
import PersonalSettings from '@/components/settings/Personal';

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
  const access = await currentAccess();
  if (!user || !access) return <p className="py-24 text-center text-fg-3">Not signed in.</p>;
  const db = await getDb();
  if (!access.admin) {
    // Someone who isn't an admin (#50): their collections and roles, what they own, and their own tokens.
    const counts = await collectionCounts(db);
    const all = (await listCollections(db)).map((c) => ({ id: c.id, name: c.name, ...(counts.get(c.id) ?? { copies: 0, minifigs: 0 }) }));
    const mine = all.filter((c) => access.roles.has(c.id)).map((c) => ({ ...c, role: access.roles.get(c.id)! }));
    const owned = mine.filter((c) => c.role === 'owner');
    const [members, shares, tokens] = await Promise.all([membersOf(db, owned.map((c) => c.id)), listShareLinks(db), listTokens(db, access.login)]);
    return <PersonalSettings me={access.login} mine={mine} owned={owned} members={members} shares={shares.filter((l) => l.collectionId != null && owned.some((c) => c.id === l.collectionId))} tokens={tokens} />;
  }
  const [locations, currency, tokens, shares, source, sources] = await Promise.all([listLocations(db), getCurrency(db), listTokens(db), listShareLinks(db), primarySource(db), valueSources(db)]);
  const counts = await collectionCounts(db);
  const collections = (await listCollections(db)).map((c) => ({ id: c.id, name: c.name, ...(counts.get(c.id) ?? { copies: 0, minifigs: 0 }) }));
  const valueSource = { current: source, options: sources.map((s): [string, string] => [s, sourceLabel(s)]) };
  const people = await listPeople(db);
  return <Settings people={people} me={access.login} envAdmins={adminList().length > 0} collections={collections} version={await cachedUpdateStatus(db)} locations={locations} currency={currency} valueSource={valueSource} tokens={tokens} shares={shares} user={user.user} authMode={authMode()} priced={!!bricklink()} alerts={!!alertsFromEnv()} rebrickable={{ key: !!rebrickable(), stats: await rebrickableStats(db), run: rebrickableRun() }} brickset={{ key: !!brickset(), stats: await retailStats(db) }} ldraw={await libraryStatus()} barcodes={{ caps: barcodeCaps(), saved: await barcodeStats(db), community: await communityStatus(db) }} />;
}
