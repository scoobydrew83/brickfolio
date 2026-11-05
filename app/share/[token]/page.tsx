import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import ShareView from '@/components/ShareView';
import { getDb } from '@/lib/db';
import { checkShareLink, sharedCollection } from '@/lib/service/share';
import { getCurrency } from '@/lib/service/sets';

export const metadata = { title: 'Shared collection', robots: { index: false, follow: false } };

/** A read-only view of the collection for whoever has the link. Never asks who the viewer is and has no actions. */
export default async function SharePage({ params }: PageProps<'/share/[token]'>) {
  await connection();
  const db = await getDb();
  const token = decodeURIComponent((await params).token);
  const link = await checkShareLink(db, token);
  if (!link) notFound(); // unknown, revoked and expired links all look the same
  return <ShareView data={await sharedCollection(db, link, await getCurrency(db), token)} />;
}
