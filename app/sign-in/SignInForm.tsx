'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';
import { Banner, Button, field } from '@/components/ui';
import { PasskeySignInButton } from '@/components/auth/PasskeySignInButton';

type Provider = { id: 'google' | 'github' | 'apple'; name: string };

/**
 * Email + password, plus a button per configured provider and, with email set up, an emailed sign-in link.
 * "Create account" works for the first account (it becomes the admin), then only if allowed.
 */
export function SignInForm({ canReset = false, canEmailLink = false, providers = [], initialError = null }: {
  canReset?: boolean; canEmailLink?: boolean; providers?: Provider[]; initialError?: string | null;
}) {
  const [mode, setMode] = useState<'in' | 'up' | 'link'>('in');
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [going, setGoing] = useState<string | null>(null);
  const router = useRouter();
  const say = (e: string | null, n: string | null = null) => { setError(e); setNotice(n); };

  const submit = (form: FormData) => start(async () => {
    const email = String(form.get('email') ?? '');
    if (mode === 'link') {
      // The plugin's client isn't registered (lib/auth-client.ts stays plain); its endpoint is called directly.
      const r = await authClient.$fetch('/sign-in/magic-link', { method: 'POST', body: { email, callbackURL: '/', errorCallbackURL: '/sign-in' } });
      // The same answer whether or not the address has an account (nothing is sent to one that can't sign in).
      if (r.error) say(r.error.message ?? 'That didn’t work.');
      else say(null, `If ${email} can sign in here, a link is on its way. It works once, for 10 minutes.`);
      return;
    }
    const password = String(form.get('password') ?? '');
    let r = mode === 'in'
      ? await authClient.signIn.email({ email, password })
      : await authClient.signUp.email({ email, password, name: String(form.get('name') ?? '') || email });
    // Sign-up never signs in (addresses must be verified): the first account already is, so sign it in now.
    if (mode === 'up' && !r.error) r = await authClient.signIn.email({ email, password });
    if (r.error?.code === 'EMAIL_NOT_VERIFIED') say(null, 'Check your email for a link to confirm your address, then sign in.');
    else if (r.error) say(r.error.message ?? 'That didn’t work.');
    // With two-factor on, a password sign-in stops here: twoFactorClient has gone to /sign-in/two-factor.
    else if (r.data && 'twoFactorRedirect' in r.data && r.data.twoFactorRedirect) return;
    // Signing in for an MCP client (OAuth): Better Auth answers with where the authorization continues.
    else if (r.data && 'url' in r.data && typeof r.data.url === 'string' && r.data.url) window.location.assign(r.data.url);
    else { router.replace('/'); router.refresh(); }
  });

  const social = async (p: Provider) => {
    setGoing(p.id);
    say(null);
    // Better Auth sends the browser to the provider; errors come back as /sign-in?error=… (see ./errors.ts).
    const r = await authClient.signIn.social({ provider: p.id, callbackURL: '/', errorCallbackURL: '/sign-in' });
    if (r.error) { setGoing(null); say(r.error.message ?? 'That didn’t work.'); }
  };

  return (
    <div className="space-y-4">
      {error && <Banner kind="error" onDismiss={() => setError(null)}>{error}</Banner>}
      {notice && <Banner kind="ok" onDismiss={() => setNotice(null)}>{notice}</Banner>}
      {(providers.length > 0 || mode === 'in') && (
        <div className="space-y-2">
          {mode === 'in' && <PasskeySignInButton />}
          {providers.map((p) => (
            <Button key={p.id} className="w-full" loading={going === p.id} disabled={!!going} onClick={() => social(p)}>
              Continue with {p.name}
            </Button>
          ))}
          <p className="flex items-center gap-3 pt-2 text-xs text-fg-3" aria-hidden>
            <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
          </p>
        </div>
      )}
      <form action={submit} className="space-y-3">
        {mode === 'up' && <label className="block text-sm">Name<input name="name" className={field} autoComplete="name" /></label>}
        <label className="block text-sm">Email<input name="email" type="email" required className={field} autoComplete="email webauthn" /></label>
        {mode !== 'link' && <label className="block text-sm">Password<input name="password" type="password" required minLength={10} className={field} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} /></label>}
        <Button type="submit" variant="primary" loading={pending}>{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Email me a sign-in link'}</Button>
        <div className="flex flex-col items-start gap-2">
          {canEmailLink && <Button variant="link" onClick={() => { say(null); setMode(mode === 'link' ? 'in' : 'link'); }}>{mode === 'link' ? 'Use a password instead' : 'Email me a sign-in link'}</Button>}
          {mode !== 'link' && <Button variant="link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>{mode === 'in' ? 'Create an account' : 'I have an account'}</Button>}
          {canReset && mode === 'in' && <Link href="/reset-password" className="text-sm underline">Forgot your password?</Link>}
        </div>
      </form>
    </div>
  );
}
