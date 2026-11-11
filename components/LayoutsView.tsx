'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { createLayout } from '@/app/actions';
import { sizeLabel } from '@/lib/layouts';
import type { LayoutSummary } from '@/lib/service/layouts';
import { LayoutFields } from './layouts/LayoutEditor';
import { PageHeader } from './shell/PageHeader';
import { Button, Callout, Dialog, EmptyState } from './ui';

/** Your MILS layouts, and New layout. */
export default function LayoutsView({ layouts }: { layouts: LayoutSummary[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const create = (form: FormData) => start(async () => {
    const r = await createLayout(Object.fromEntries(form));
    if (r.ok) router.push(`/layouts/${r.id}`); else setError(r.error);
  });
  const newButton = <Button variant="primary" icon={Plus} onClick={() => { setError(null); setOpen(true); }}>New layout</Button>;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex gap-1.5 text-sm text-fg-3">
        <Link href="/parts" className="text-link hover:underline">Parts</Link><span aria-hidden>/</span><span className="text-fg">Layouts</span>
      </nav>
      <PageHeader title="Layouts" actions={layouts.length > 0 && newButton}>
        <p>Plan a town or train layout on a grid of MILS modules (32 × 32 studs), and see what you still need for it.</p>
      </PageHeader>

      {layouts.length === 0 ? (
        <EmptyState title="No layouts yet" action={newButton}>
          Start with the size of your table in modules. Then add modules, set roads, and link the sets and builds that stand on each.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {layouts.map((l) => (
            <li key={l.id}>
              <Link href={`/layouts/${l.id}`} className="block rounded-callout focus-visible:outline-2 focus-visible:outline-focus">
                <Callout className="h-full p-4 transition-colors hover:bg-subtle">
                  <p className="truncate font-semibold">{l.name}</p>
                  <p className="mt-1 text-xs text-fg-3 tabular-nums">{sizeLabel(l.cols, l.rows)}</p>
                  <p className="mt-3 text-sm text-fg-2">{l.modules ? <><b className="tabular-nums text-fg">{l.modules}</b> {l.modules === 1 ? 'module' : 'modules'} placed</> : 'No modules placed yet'}</p>
                </Callout>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <Dialog
          title="New layout"
          onClose={() => setOpen(false)}
          footer={<>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" form="new-layout" loading={pending}>Create</Button>
          </>}
        >
          <LayoutFields id="new-layout" action={create} error={error} />
        </Dialog>
      )}
    </div>
  );
}
