'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addPassword, changeName, changePassword, revokeOtherSessions, revokeSession, unlinkAccount } from '@/app/(app)/account/actions';
import { authClient } from '@/lib/auth-client';
import type { AccountInfo } from '@/lib/account';
import type { Result } from '@/lib/service/sets';
import { Banner, Button, field } from '../ui';
import { PageHeader } from '../shell/PageHeader';
import { InviteActions } from './InviteActions';
import { PasskeysSection } from './PasskeysSection';
import { TwoFactorSection } from './TwoFactorSection';

const h2 = 'text-lg font-extrabold [font-stretch:110%]';
const section = 'space-y-3 border-t border-line pt-6';
const PROVIDERS: Record<string, string> = { credential: 'Email and password', google: 'Google', github: 'GitHub', apple: 'Apple' };
type Run = (fn: () => Promise<Result>, ok: string, after?: () => void) => void;

/** "Firefox on Mac" from a user agent; good enough to tell sessions apart. */
export function deviceName(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null;
  return os ? `${browser} on ${os}` : browser;
}
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** /account with AUTH_MODE=better-auth: invitations for you, profile, password, sign-in methods and sessions. */
export default function AccountView({ info }: { info: AccountInfo }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const run: Run = (fn, ok, after) => start(async () => { const r = await fn(); setNote(r.ok ? { kind: 'ok', text: ok } : { kind: 'error', text: r.error }); if (r.ok) after?.(); });
  const [out, startOut] = useTransition();
  const router = useRouter();
  const signOut = () => startOut(async () => { await authClient.signOut(); router.replace('/sign-in'); router.refresh(); });
  return (
    <div className="space-y-6">
      <PageHeader title="Account" actions={<Button loading={out} onClick={signOut}>Sign out</Button>}>
        Signed in as <b className="break-all text-fg-2">{info.email}</b>
      </PageHeader>
      {note && <Banner kind={note.kind} onDismiss={() => setNote(null)}>{note.text}</Banner>}

      {info.invitations.length > 0 && (
        <section className={section} aria-labelledby="invites-title">
          <h2 id="invites-title" className={h2}>Invitations for you</h2>
          <ul className="divide-y divide-line">
            {info.invitations.map((i) => (
              <li key={i.id} className="space-y-2 py-2 text-sm">
                <p><b>{i.inviter}</b> invited you to <b>{i.collection}</b> as {i.role}.</p>
                <InviteActions id={i.id} collection={i.collection} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <Profile info={info} pending={pending} run={run} />
      <Password has={info.hasPassword} pending={pending} run={run} />
      <SignInMethods info={info} pending={pending} run={run} />

      <PasskeysSection />
      <TwoFactorSection />

      <Sessions info={info} pending={pending} run={run} />
    </div>
  );
}

function Profile({ info, pending, run }: { info: AccountInfo; pending: boolean; run: Run }) {
  return (
    <section className={section} aria-labelledby="profile-title">
      <h2 id="profile-title" className={h2}>Profile</h2>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const name = String(new FormData(e.currentTarget).get('name') ?? ''); run(() => changeName(name), 'Saved your name.'); }}>
        <label className="sr-only" htmlFor="account-name">Name</label>
        <input id="account-name" name="name" required maxLength={100} defaultValue={info.name} autoComplete="name" className={`${field} mt-0`} />
        <Button type="submit" disabled={pending}>Save</Button>
      </form>
      <p className="text-sm text-fg-3">
        Email: <span className="break-all text-fg-2">{info.email}</span>. It&apos;s your sign-in and what your roles, API tokens and share links are recorded under, so it can&apos;t be changed here. Ask an admin if it has to change.
      </p>
    </section>
  );
}

function Password({ has, pending, run }: { has: boolean; pending: boolean; run: Run }) {
  const [mismatch, setMismatch] = useState(false);
  return (
    <section className={section} aria-labelledby="password-title">
      <h2 id="password-title" className={h2}>Password</h2>
      <form className="grid gap-2 sm:max-w-sm" onSubmit={(e) => {
        e.preventDefault(); const f = e.currentTarget; const d = new FormData(f);
        const current = String(d.get('current') ?? ''), next = String(d.get('next') ?? ''), again = String(d.get('again') ?? '');
        if (next !== again) { setMismatch(true); return; }
        setMismatch(false);
        if (has) run(() => changePassword(current, next), 'Changed your password. Every other session is signed out.', () => f.reset());
        else run(() => addPassword(next), 'Added a password: you can now sign in with your email and it.', () => f.reset());
      }}>
        {has
          ? <label className="block text-sm">Current password<input name="current" type="password" required autoComplete="current-password" className={field} /></label>
          : <p className="text-sm text-fg-3">You sign in without a password. Add one to also sign in with your email.</p>}
        <label className="block text-sm">New password<input name="next" type="password" required minLength={10} maxLength={128} autoComplete="new-password" className={field} /></label>
        <label className="block text-sm">New password again<input name="again" type="password" required minLength={10} maxLength={128} autoComplete="new-password" className={field} aria-invalid={mismatch || undefined} /></label>
        {mismatch && <p className="text-sm text-danger">The two new passwords don&apos;t match.</p>}
        <div><Button type="submit" disabled={pending}>{has ? 'Change password' : 'Add password'}</Button></div>
        {has && <p className="text-xs text-fg-3">Changing it signs out your other sessions.</p>}
      </form>
    </section>
  );
}

function SignInMethods({ info, pending, run }: { info: AccountInfo; pending: boolean; run: Run }) {
  const usable = info.accounts.filter((a) => a.usable);
  return (
    <section className={section} aria-labelledby="methods-title">
      <h2 id="methods-title" className={h2}>Sign-in methods</h2>
      <ul className="divide-y divide-line text-sm">
        {info.accounts.map((a) => {
          const label = PROVIDERS[a.providerId] ?? a.providerId;
          const last = usable.length <= 1 && usable.some((u) => u.id === a.id);
          return (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><b>{label}</b> <span className="text-xs text-fg-3">· added {when(a.createdAt)}{!a.usable && a.providerId !== 'credential' ? ' · not set up on this server' : ''}</span></span>
              {last ? <span className="text-xs text-fg-3">Your only way to sign in</span>
                : <Button variant="danger-link" disabled={pending} onClick={() => run(() => unlinkAccount(a.id), `Removed ${label}.`)}>Remove</Button>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Sessions({ info, pending, run }: { info: AccountInfo; pending: boolean; run: Run }) {
  const others = info.sessions.filter((s) => !s.current).length;
  return (
    <section className={section} aria-labelledby="sessions-title">
      <h2 id="sessions-title" className={h2}>Where you&apos;re signed in</h2>
      <ul className="divide-y divide-line text-sm">
        {info.sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <b>{deviceName(s.userAgent)}</b>{s.current && <span className="text-xs text-fg-3"> · this browser</span>}
              <span className="block text-xs text-fg-3">{s.ipAddress ? `${s.ipAddress} · ` : ''}signed in {when(s.createdAt)} · last active {when(s.updatedAt)}</span>
            </span>
            {!s.current && <Button variant="danger-link" disabled={pending} onClick={() => run(() => revokeSession(s.id), `Signed out ${deviceName(s.userAgent)}.`)}>Sign out</Button>}
          </li>
        ))}
      </ul>
      {others > 0 && <Button disabled={pending} onClick={() => run(() => revokeOtherSessions(), 'Signed out everywhere else.')}>Sign out everywhere else</Button>}
    </section>
  );
}
