'use client';
import { useState, useTransition } from 'react';
import { type Result } from '@/app/actions';
import { Banner, toast } from '../ui';
import { PageHeader } from '../shell/PageHeader';
import { ShareSection, type CollectionInfo } from '../Settings';
import { MembersSection } from './People';
import { InvitationsSection } from './Invitations';
import { TokensSection, type Token } from './Tokens';
import type { InviteRow } from '@/lib/service/invitations';
import type { ShareLinkRow } from '@/lib/service/share';
import type { Role } from '@/lib/service/permissions';

const h2 = 'text-lg font-extrabold [font-stretch:110%]';
const section = 'space-y-3 border-t border-line pt-6';

/**
 * Settings for someone who isn't an admin (#50): which collections they have and in what role, the members and share
 * links of collections they own, and their own API tokens (which act with their permissions). Server settings,
 * keys and sync are for admins.
 */
export default function PersonalSettings({ me, mine, owned, members, shares, tokens, invitations }: {
  me: string; mine: (CollectionInfo & { role: Role })[]; owned: CollectionInfo[];
  members: { collectionId: number; login: string; role: Role }[]; shares: ShareLinkRow[]; tokens: Token[];
  /** AUTH_MODE=better-auth (#90): pending invitations to the collections they own, and whether they're mailed. */
  invitations?: { list: InviteRow[]; mail: boolean };
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ kind: 'error'; text: string } | null>(null);
  const run = (fn: () => Promise<Result>, ok: string, after?: (r: Result) => void) => start(async () => {
    const r = await fn();
    if (!r.ok) return setNote({ kind: 'error', text: r.error });
    setNote(null);
    toast.success(ok);
    after?.(r);
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />
      {note && <Banner kind={note.kind} onDismiss={() => setNote(null)}>{note.text}</Banner>}
      <section className="space-y-2 text-sm text-fg-2">
        <p>Signed in as <b className="break-all">{me}</b>. Server settings, keys and the sync are for admins.</p>
        {mine.length ? (
          <ul className="divide-y divide-line">
            {mine.map((c) => <li key={c.id} className="flex justify-between gap-3 py-1.5"><span>{c.name}</span><span className="text-fg-3">{c.role}</span></li>)}
          </ul>
        ) : <p className="text-fg-3">You don&apos;t have access to any collection yet. Ask an admin to add you to one.</p>}
      </section>

      <MembersSection collections={owned} members={members} me={me} />
      {invitations && <InvitationsSection collections={owned} invites={invitations.list} mail={invitations.mail} />}
      {owned.length > 0 && <ShareSection links={shares} collections={owned} allowAll={false} />}

      <section className={section}>
        <TokensSection tokens={tokens} me={me} all={false} pending={pending} run={run} intro={<>
          <h2 className={h2}>Your API tokens</h2>
          <p className="text-sm text-fg-3">For scripts and apps: send <code className="rounded-chip bg-muted px-1">Authorization: Bearer &lt;token&gt;</code> to <code className="rounded-chip bg-muted px-1">/api/v1</code>. A token can see and do what you can.</p>
        </>} />
      </section>
    </div>
  );
}
