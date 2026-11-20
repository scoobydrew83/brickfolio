import { Suspense } from 'react';
import { PageSkeleton } from '@/components/ui';
import { connection } from 'next/server';
import { PageHeader } from '@/components/shell/PageHeader';
import StoreView from '@/components/StoreView';
import { getDb } from '@/lib/db';
import { getCurrency } from '@/lib/service/sets';
import { listInventory } from '@/lib/service/store';
import { pageBlock } from '@/lib/session';

export const metadata = { title: 'Store' };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader title="Store inventory" />
      <Suspense fallback={<PageSkeleton />}>
        <Content />
      </Suspense>
    </div>
  );
}

async function Content() {
  await connection();
  const blocked = await pageBlock('admin'); // #50
  if (blocked) return <p className="py-24 text-center text-fg-3">{blocked}</p>;
  const db = await getDb();
  const [items, currency] = await Promise.all([listInventory(db), getCurrency(db)]);
  return <StoreView items={items} currency={currency} syncedAt={items[0]?.syncedAt ?? null} />;
}
