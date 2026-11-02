import { Suspense } from 'react';
import { PageSkeleton } from '@/components/ui';
import { connection } from 'next/server';
import Board from '@/components/Board';
import { getDb } from '@/lib/db';
import { getCollection } from '@/lib/service/sets';
import { bricklink, currentUser } from '@/lib/session';

export default function Page() {
  return (
    <>
      <Suspense fallback={<PageSkeleton />}>
        <Sets />
      </Suspense>
    </>
  );
}

async function Sets() {
  await connection(); // always read fresh, never at build time
  const user = await currentUser();
  if (!user) return <p className="py-24 text-center text-fg-3">Not signed in.</p>;
  const data = await getDb().then(getCollection).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
  if (typeof data === 'string') {
    return (
      <div className="rounded-card border border-danger-ring bg-danger-soft p-6 text-danger">
        <p className="font-semibold">Couldn&apos;t open the database.</p>
        <p className="mt-1 text-sm">{data}</p>
      </div>
    );
  }
  return <Board {...data} user={user.user} priced={!!bricklink()} />;
}
