import { Suspense } from 'react';
import { connection } from 'next/server';
import RadarView from '@/components/RadarView';
import { PageSkeleton } from '@/components/ui';
import { getDb } from '@/lib/db';
import { getRadar } from '@/lib/service/radar';
import { listProjects } from '@/lib/service/designer';
import { brickset, currentUser } from '@/lib/session';

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
  if (!(await currentUser())) return <p className="py-24 text-center text-fg-3">Not signed in.</p>;
  const db = await getDb();
  const [radar, projects] = await Promise.all([getRadar(db), listProjects(db)]);
  return <RadarView radar={radar} projects={projects} hasBrickset={!!brickset()} />;
}
