import { Suspense } from 'react';
import { connection } from 'next/server';
import RadarView from '@/components/RadarView';
import { PageSkeleton } from '@/components/ui';
import { getDb } from '@/lib/db';
import { getRadar } from '@/lib/service/radar';
import { listProjects } from '@/lib/service/designer';
import { brickset, currentCollection, pageBlock } from '@/lib/session';

export const metadata = { title: 'Retirement Radar' };

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
  const [radar, projects] = await Promise.all([getRadar(db, undefined, { collectionId: scope }), listProjects(db, undefined, scope)]);
  return <RadarView radar={radar} projects={projects} hasBrickset={!!brickset()} />;
}
