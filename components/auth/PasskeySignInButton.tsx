'use client';
// "Sign in with a passkey" (#90 phase 2). Self-contained: put it anywhere on the sign-in page. It also offers saved
// passkeys in the browser's autofill (conditional UI) when an input on the page has `autoComplete="… webauthn"`.
// A passkey sign-in doesn't ask for two-factor: the passkey is already two factors (the device and its PIN or face).
import { useEffect, useState, useSyncExternalStore, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Banner, Button } from '@/components/ui';

const noop = () => () => {};
/** Errors that only mean the person closed the browser's passkey prompt (or the autofill request was replaced). */
const CANCELLED = new Set(['AUTH_CANCELLED', 'ERROR_CEREMONY_ABORTED', 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY']);

export function PasskeySignInButton({ next = '/', autoFill = true }: { next?: string; autoFill?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  // No WebAuthn in this browser: no button. (The server render assumes there is.)
  const supported = useSyncExternalStore(noop, () => !!window.PublicKeyCredential, () => true);
  const [pending, start] = useTransition();
  const router = useRouter();

  const done = (r: { error: { code?: string; message?: string } | null }) => {
    if (!r.error) { router.replace(next); router.refresh(); }
    else if (!CANCELLED.has(r.error.code ?? '')) setError(r.error.message ?? 'That passkey didn’t work.');
  };

  useEffect(() => {
    if (!autoFill || !window.PublicKeyCredential) return;
    let live = true;
    // Conditional UI: the request waits until someone picks a passkey from autofill. Clicking the button replaces it.
    PublicKeyCredential.isConditionalMediationAvailable?.().then((ok) => {
      if (ok && live) authClient.signIn.passkey({ autoFill: true }).then((r) => { if (live) done(r); });
    }).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  if (!supported) return null;
  return (
    <div className="space-y-2">
      {error && <Banner kind="error" onDismiss={() => setError(null)}>{error}</Banner>}
      <Button icon={KeyRound} loading={pending} className="w-full" onClick={() => { setError(null); start(async () => done(await authClient.signIn.passkey())); }}>
        Sign in with a passkey
      </Button>
    </div>
  );
}
