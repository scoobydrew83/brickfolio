'use client';
// Your passkeys (#90 phase 2): list, add with a name, rename, delete. Self-contained (Better Auth's client); for the
// account page. Adding one needs a recent sign-in (Better Auth's fresh session, one day).
import { useState, useTransition } from 'react';
import { KeyRound, Pencil, Trash2 } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Banner, Button, IconButton, Skeleton, field } from '@/components/ui';

const h2 = 'text-lg font-extrabold [font-stretch:110%]';
const section = 'space-y-3 border-t border-line pt-6';
type Note = { kind: 'ok' | 'error'; text: string } | null;
type Err = { code?: string; message?: string } | null;

const message = (e: NonNullable<Err>) => e.code === 'SESSION_NOT_FRESH' ? 'Sign out and in again, then add the passkey (it needs a recent sign-in).' : e.message ?? 'That didn’t work.';
const date = (d: Date | string) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export function PasskeysSection() {
  const list = authClient.useListPasskeys();
  const [note, setNote] = useState<Note>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error: Err }>, ok: string, after?: () => void) => start(async () => {
    const r = await fn();
    if (r.error) { if (r.error.code !== 'ERROR_CEREMONY_ABORTED') setNote({ kind: 'error', text: message(r.error) }); return; }
    setNote({ kind: 'ok', text: ok });
    after?.();
    list.refetch();
  });
  const passkeys = list.data ?? [];

  return (
    <section className={section} aria-labelledby="passkeys-h">
      <h2 id="passkeys-h" className={h2}>Passkeys</h2>
      <p className="text-sm text-fg-3">Sign in with your device&apos;s fingerprint, face or PIN instead of your password. A passkey sign-in doesn&apos;t ask for a two-factor code: it is already two factors.</p>
      {note && <Banner kind={note.kind} onDismiss={() => setNote(null)}>{note.text}</Banner>}
      {list.isPending ? <Skeleton className="h-10 w-full" /> : passkeys.length > 0 && (
        <ul className="divide-y divide-line text-sm">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2">
              {renaming === p.id ? (
                <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); const name = String(new FormData(e.currentTarget).get('name')).trim(); run(() => authClient.passkey.updatePasskey({ id: p.id, name }), 'Passkey renamed.', () => setRenaming(null)); }}>
                  <input name="name" required maxLength={60} defaultValue={p.name ?? ''} aria-label="Passkey name" autoFocus className={`${field} mt-0`} />
                  <Button type="submit" size="sm" disabled={pending}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                </form>
              ) : <>
                <span className="flex min-w-0 items-center gap-2">
                  <KeyRound aria-hidden className="size-4 shrink-0 text-fg-3" />
                  <span className="min-w-0"><b className="break-words">{p.name || 'Passkey'}</b> <span className="text-xs text-fg-3">added {date(p.createdAt)}{p.backedUp ? ' · synced' : ''}</span></span>
                </span>
                <span className="flex shrink-0">
                  <IconButton icon={Pencil} label={`Rename ${p.name || 'passkey'}`} onClick={() => setRenaming(p.id)} disabled={pending} />
                  <IconButton icon={Trash2} tone="danger" label={`Delete ${p.name || 'passkey'}`} disabled={pending}
                    onClick={() => { if (confirm(`Delete ${p.name || 'this passkey'}? You won't be able to sign in with it.`)) run(() => authClient.passkey.deletePasskey({ id: p.id }), 'Passkey deleted.'); }} />
                </span>
              </>}
            </li>
          ))}
        </ul>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const name = String(new FormData(f).get('name')).trim(); run(() => authClient.passkey.addPasskey({ name }), 'Passkey added.', () => f.reset()); }}>
        <input name="name" required maxLength={60} placeholder="Name, e.g. MacBook or iPhone" aria-label="Passkey name" className={`${field} mt-0`} />
        <Button type="submit" icon={KeyRound} loading={pending}>Add a passkey</Button>
      </form>
    </section>
  );
}
