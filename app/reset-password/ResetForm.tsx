'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';
import { Banner, Button, field } from '@/components/ui';

/** With a token: the new password. Without: an email to send a link to (only when email is set up). */
export function ResetForm({ token, invalid, canEmail }: { token: string | null; invalid: boolean; canEmail: boolean }) {
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(invalid ? { kind: 'error', text: 'That link has expired or was already used. Ask for a new one.' } : null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const back = <Link href="/sign-in" className="text-sm underline">Back to sign-in</Link>;

  if (token && !invalid) {
    const submit = (form: FormData) => start(async () => {
      const a = String(form.get('password') ?? ''), b = String(form.get('again') ?? '');
      if (a !== b) return setNote({ kind: 'error', text: "The passwords don't match." });
      const r = await authClient.resetPassword({ newPassword: a, token });
      if (r.error) setNote({ kind: 'error', text: r.error.message ?? 'That didn’t work.' });
      else { setDone(true); setNote({ kind: 'ok', text: 'Password changed. Sign in with it.' }); }
    });
    return (
      <form action={submit} className="space-y-3">
        {note && <Banner kind={note.kind} onDismiss={() => setNote(null)}>{note.text}</Banner>}
        {!done && <>
          <label className="block text-sm">New password<input name="password" type="password" required minLength={10} maxLength={128} className={field} autoComplete="new-password" /></label>
          <label className="block text-sm">Again<input name="again" type="password" required minLength={10} maxLength={128} className={field} autoComplete="new-password" /></label>
          <Button type="submit" variant="primary" loading={pending}>Change password</Button>
        </>}
        <p>{back}</p>
      </form>
    );
  }
  if (!canEmail) return <div className="space-y-3">{note && <Banner kind={note.kind}>{note.text}</Banner>}<p className="text-sm text-fg-3">Ask an admin for a reset link (Settings → People).</p><p>{back}</p></div>;
  const ask = (form: FormData) => start(async () => {
    const r = await authClient.requestPasswordReset({ email: String(form.get('email') ?? ''), redirectTo: '/reset-password' });
    setNote(r.error ? { kind: 'error', text: r.error.message ?? 'That didn’t work.' } : { kind: 'ok', text: 'If that email has an account, a reset link is on its way.' });
  });
  return (
    <form action={ask} className="space-y-3">
      {note && <Banner kind={note.kind} onDismiss={() => setNote(null)}>{note.text}</Banner>}
      <label className="block text-sm">Email<input name="email" type="email" required className={field} autoComplete="email" /></label>
      <Button type="submit" variant="primary" loading={pending}>Send a reset link</Button>
      <p>{back}</p>
    </form>
  );
}
