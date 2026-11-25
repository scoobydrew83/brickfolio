'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { acceptInvitation, declineInvitation } from '@/app/invite/actions';
import { Banner, Button, Confirm } from '../ui';

/** Accept / Decline for an invitation addressed to the signed-in person. Accepting goes to the collection. */
export function InviteActions({ id, collection }: { id: string; collection: string }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const router = useRouter();
  const go = (accept: boolean) => start(async () => {
    const r = await (accept ? acceptInvitation(id) : declineInvitation(id));
    if (!r.ok) { setNote({ kind: 'error', text: r.error }); return; }
    if (accept) { router.push('/'); router.refresh(); } else setNote({ kind: 'ok', text: `Declined the invitation to ${collection}.` });
  });
  if (note?.kind === 'ok') return <Banner kind="ok">{note.text}</Banner>;
  return (
    <div className="space-y-2">
      {note && <Banner kind="error" onDismiss={() => setNote(null)}>{note.text}</Banner>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={pending} onClick={() => go(true)}>Accept</Button>
        <Confirm title={`Decline the invitation to ${collection}?`} body="The invitation is used up. To join later you'd need a new one." confirmLabel="Decline" tone="danger" onConfirm={() => go(false)}>
          <Button disabled={pending}>Decline</Button>
        </Confirm>
      </div>
    </div>
  );
}
