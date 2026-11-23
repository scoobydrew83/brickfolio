'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';
import { Banner, Button, field } from '@/components/ui';

/** A 6-digit code from the authenticator app, or one of the backup codes (each works once). */
export function TwoFactorForm() {
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const submit = (form: FormData) => start(async () => {
    const code = String(form.get('code') ?? '').trim();
    const trustDevice = form.get('trust') === 'on';
    const r = backup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ''), trustDevice });
    if (!r.error) { router.replace('/'); router.refresh(); return; }
    // The pending sign-in lasts 10 minutes, and a few wrong codes end it: start again from the password.
    if (r.error.code === 'INVALID_TWO_FACTOR_COOKIE' || r.error.status === 429) setExpired(true);
    setError(r.error.message ?? 'That code didn’t work.');
  });
  return (
    <form action={submit} className="space-y-3">
      {error && <Banner kind="error" onDismiss={() => setError(null)}>{error}</Banner>}
      {expired ? (
        <p className="text-sm"><Link href="/sign-in" className="underline">Sign in again</Link></p>
      ) : <>
        <p className="text-sm text-fg-2">{backup ? 'Enter one of the backup codes you saved. Each one works once.' : 'Enter the 6-digit code from your authenticator app.'}</p>
        <label className="block text-sm">
          {backup ? 'Backup code' : 'Code'}
          {backup
            ? <input key="backup" name="code" required autoComplete="off" autoCapitalize="none" spellCheck={false} className={field} />
            : <input key="totp" name="code" required inputMode="numeric" pattern="[0-9 ]{6,7}" maxLength={7} autoComplete="one-time-code" autoFocus className={field} />}
        </label>
        <label className="flex items-center gap-2 text-sm text-fg-2"><input name="trust" type="checkbox" /> Don&apos;t ask again on this device for 30 days</label>
        <Button type="submit" variant="primary" loading={pending}>Sign in</Button>
        <Button variant="link" onClick={() => { setBackup(!backup); setError(null); }}>{backup ? 'Use the authenticator app' : 'Use a backup code'}</Button>
        <p><Link href="/sign-in" className="text-sm underline">Back to sign-in</Link></p>
      </>}
    </form>
  );
}
