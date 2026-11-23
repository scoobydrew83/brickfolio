'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';
import { Banner, Button, field } from '../ui';

/**
 * Sign in, or create the account, for the invited address. Creating one is allowed while sign-up is closed (the
 * invitation counts), but only with email set up: the address is proven by the confirmation link, which comes back
 * here to accept.
 */
export function InviteSignIn({ id, email, canSignUp }: { id: string; email: string; canSignUp: boolean }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const back = `/invite/${encodeURIComponent(id)}`;
  const submit = (form: FormData) => start(async () => {
    setError(null);
    const password = String(form.get('password') ?? '');
    if (mode === 'up') {
      const r = await authClient.signUp.email({ email, password, name: String(form.get('name') ?? '') || email, callbackURL: back });
      if (r.error?.code === 'USER_ALREADY_EXISTS' || r.error?.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') { setMode('in'); setError(`There's already an account for ${email}. Sign in instead, or reset its password from the sign-in page.`); }
      else if (r.error) setError(r.error.message ?? 'That didn’t work.');
      else setNotice(`Check ${email} for a link to confirm your address. It brings you back here to accept.`);
      return;
    }
    const r = await authClient.signIn.email({ email, password, callbackURL: back });
    if (r.error?.code === 'EMAIL_NOT_VERIFIED') setNotice('Confirm your address first: follow the link in the email we sent, then come back to this page.');
    else if (r.error) setError(r.error.message ?? 'That didn’t work.');
    else router.refresh();
  });
  return (
    <form action={submit} className="space-y-3">
      {error && <Banner kind="error" onDismiss={() => setError(null)}>{error}</Banner>}
      {notice && <Banner kind="ok" onDismiss={() => setNotice(null)}>{notice}</Banner>}
      <p className="text-sm text-fg-3">{mode === 'in' ? `Sign in as ${email} to accept.` : `Create an account for ${email}.`}</p>
      {mode === 'up' && <label className="block text-sm">Name<input name="name" className={field} autoComplete="name" /></label>}
      <label className="block text-sm">Email<input name="email" type="email" value={email} readOnly className={`${field} text-fg-3`} autoComplete="email" /></label>
      <label className="block text-sm">Password<input name="password" type="password" required minLength={10} className={field} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} /></label>
      <Button type="submit" variant="primary" loading={pending}>{mode === 'in' ? 'Sign in' : 'Create account'}</Button>
      {canSignUp
        ? <Button variant="link" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null); }}>{mode === 'in' ? 'I don’t have an account yet' : 'I have an account'}</Button>
        : <p className="text-sm text-fg-3">No account yet? This server can&apos;t send email, so it can&apos;t confirm a new address: ask whoever invited you to set a password for you, then sign in here.</p>}
      <p className="text-sm text-fg-3">Sign in another way (Google, GitHub)? Use the <Link href="/sign-in" className="underline">sign-in page</Link>, then open this link again or accept it on your Account page.</p>
    </form>
  );
}

/** Signs out and reloads this page, to accept as someone else. */
export function SignOutButton() {
  const [pending, start] = useTransition();
  return <Button loading={pending} onClick={() => start(async () => { await authClient.signOut(); window.location.reload(); })}>Sign out</Button>;
}
