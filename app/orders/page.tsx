import { Suspense } from 'react';
import { PageSkeleton } from '@/components/ui';
import { connection } from 'next/server';
import { PageHeader } from '@/components/shell/PageHeader';
import OrdersView from '@/components/OrdersView';
import { getDb } from '@/lib/db';
import { getCurrency } from '@/lib/service/sets';
import { listOrders } from '@/lib/service/store';
import { currentUser } from '@/lib/session';

export const metadata = { title: 'Orders' };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader title="Orders" />
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
  const [orders, currency] = await Promise.all([listOrders(db), getCurrency(db)]);
  return <OrdersView orders={orders} currency={currency} />;
}
