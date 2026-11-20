'use client';
import { useState, useTransition } from 'react';
import { createToken, revokeToken, type Result } from '@/app/actions';
import { Banner, Button, field } from '../ui';
import { PageHeader } from '../shell/PageHeader';
import { ShareSection, type CollectionInfo } from '../Settings';
import { MembersSection } from './People';
import type { ShareLinkRow } from '@/lib/service/share';
import type { Role } from '@/lib/service/permissions';

const h2 = 'text-lg font-extrabold [font-stretch:110%]';
const section = 'space-y-3 border-t border-line pt-6';
type Token = { id: number; name: string; prefix: string; createdAt: string; lastUsedAt: string | null };

/**
 * Settings for someone who isn't an admin (#50): which collections they have and in what role, the members and share
 * links of collections they own, and their own API tokens (which act with their permissions). Server settings,
 * keys and sync are for admins.
 */
export default function PersonalSettings({ me, mine, owned, members, shares, tokens }: {
  me: string; mine: (CollectionInfo & { role: Role })[]; owned: CollectionInfo[];
  members: { collectionId: number; login: string; role: Role }[]; shares: ShareLinkRow[]; tokens: Token[];
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>, ok: string, after?: (r: Result) => void) => start(async () => { const r = await fn(); setNote(r.ok ? { kind: 'ok', text: ok } : { kind: 'error', text: r.error }); if (r.ok) after?.(r); });
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
      {owned.length > 0 && <ShareSection links={shares} collections={owned} allowAll={false} />}

      <section className={section}>
        <h2 className={h2}>Your API tokens</h2>
        <p className="text-sm text-fg-3">For scripts and apps: send <code className="rounded-chip bg-muted px-1">Authorization: Bearer &lt;token&gt;</code> to <code className="rounded-chip bg-muted px-1">/api/v1</code>. A token can see and do what you can.</p>
        {newToken && (
          <div className="space-y-1 rounded-control bg-warn-soft p-3 text-sm text-warn ring-1 ring-warn-ring">
            <p className="font-semibold">Copy this token now. It won&apos;t be shown again.</p>
            <code className="block break-all rounded-chip bg-surface px-2 py-1 font-mono text-xs">{newToken}</code>
          </div>
        )}
        <ul className="divide-y divide-line text-sm">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 py-2">
              <span><b>{t.name}</b> <code className="text-xs text-fg-3">{t.prefix}…</code></span>
              <span className="text-xs text-fg-3">{t.lastUsedAt ? `used ${t.lastUsedAt.slice(0, 10)}` : 'never used'}</span>
              <Button variant="danger-link" onClick={() => run(() => revokeToken(t.id), `Revoked ${t.name}.`)} disabled={pending}>Revoke</Button>
            </li>
          ))}
        </ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const name = String(new FormData(f).get('name')); run(() => createToken(name), 'Token created.', (r) => { if (r.ok && r.token) setNewToken(r.token); f.reset(); }); }}>
          <input name="name" required maxLength={60} placeholder="Token name, e.g. iPhone" aria-label="Token name" className={`${field} mt-0`} />
          <Button type="submit" disabled={pending}>Create</Button>
        </form>
      </section>
    </div>
  );
}
