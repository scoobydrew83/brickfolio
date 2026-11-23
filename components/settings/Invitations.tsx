'use client';
import { useState, useTransition } from 'react';
import { cancelInvitation, inviteMember } from '@/app/invite/actions';
import type { InviteRow } from '@/lib/service/invitations';
import type { Role } from '@/lib/service/permissions';
import { Banner, Button, field } from '../ui';

const h2 = 'text-lg font-extrabold [font-stretch:110%]';
const section = 'space-y-3 border-t border-line pt-6';
const ROLES: Role[] = ['viewer', 'editor', 'owner'];

function CopyLink({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button variant="link" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt(label, url); } }}>
      {copied ? 'Copied' : 'Copy link'}
    </Button>
  );
}

/**
 * Invite someone by email to a collection you manage (#90 phase 2): admins to any collection, owners to theirs.
 * With email set up the link is mailed; without, it's shown to copy (it's also under Copy link while pending). The
 * link alone gives nothing: they still sign in, or confirm their address, as the invited email.
 */
export function InvitationsSection({ collections, invites, mail }: { collections: { id: number; name: string }[]; invites: InviteRow[]; mail: boolean }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  if (!collections.length) return null;
  const day = (iso: string) => iso.slice(0, 10);
  return (
    <section className={section} aria-labelledby="invitations-title">
      <h2 id="invitations-title" className={h2}>Invitations</h2>
      <p className="text-sm text-fg-3">
        Invite someone by email. They sign in, or create an account for that address (even while sign-up is closed), and get the role. An invitation works for 7 days.
        {!mail && ' Email isn’t set up, so copy the link and send it to them yourself. Without email a new account can’t confirm its address: they need an account already, or a password you set in People.'}
      </p>
      {note && <Banner kind={note.kind} onDismiss={() => setNote(null)}>{note.text}</Banner>}
      {link && (
        <Banner kind="ok" onDismiss={() => setLink(null)}>
          Invitation link for {link.email}. Send it to them: it works only for someone who signs in as {link.email}.
          <input readOnly value={link.url} aria-label={`Invitation link for ${link.email}`} className={`${field} mt-2 font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
        </Banner>
      )}
      <form className="flex flex-wrap gap-2" onSubmit={(e) => {
        e.preventDefault(); const f = e.currentTarget; const d = new FormData(f);
        const email = String(d.get('email') ?? '').trim(), role = String(d.get('role') ?? 'viewer'), collectionId = Number(d.get('collection'));
        const name = collections.find((c) => c.id === collectionId)?.name ?? 'the collection';
        start(async () => {
          setLink(null);
          const r = await inviteMember(collectionId, email, role);
          if (!r.ok) { setNote({ kind: 'error', text: r.error }); return; }
          f.reset();
          if (r.sent) setNote({ kind: 'ok', text: `Sent ${email} an invitation to ${name} as ${role}.` });
          else {
            setNote(r.mailError ? { kind: 'error', text: `Invited ${email}, but the email didn't go out (${r.mailError}). Copy the link instead.` } : null);
            if (r.url) setLink({ email, url: r.url });
          }
        });
      }}>
        <input name="email" type="email" required maxLength={200} placeholder="Their email" aria-label="Email to invite" autoCapitalize="none" className={`${field} mt-0 min-w-48 flex-1`} />
        {collections.length > 1
          ? <select name="collection" aria-label="Collection" className={`${field} mt-0 w-auto`}>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          : <input type="hidden" name="collection" value={collections[0].id} />}
        <select name="role" defaultValue="viewer" aria-label="Role" className={`${field} mt-0 w-auto`}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
        <Button type="submit" disabled={pending}>Invite</Button>
      </form>
      {invites.length > 0 && (
        <ul className="divide-y divide-line text-sm" aria-label="Pending invitations">
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="break-all font-medium">{i.email}</span>
                <span className="text-xs text-fg-3"> · {i.role} of {i.collection} · by {i.inviter} · until {day(i.expiresAt)}</span>
              </span>
              <span className="flex gap-3">
                <CopyLink url={i.url} label={`Invitation link for ${i.email}`} />
                <Button variant="danger-link" disabled={pending} onClick={() => start(async () => { const r = await cancelInvitation(i.id); setNote(r.ok ? { kind: 'ok', text: `Cancelled the invitation for ${i.email}.` } : { kind: 'error', text: r.error }); })}>Cancel</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
