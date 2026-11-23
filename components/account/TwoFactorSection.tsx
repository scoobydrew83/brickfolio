'use client';
// Two-factor sign-in (#90 phase 2): an authenticator app (TOTP) plus backup codes. Self-contained (Better Auth's
// client); for the account page. Turning it on: password → scan the QR code (or type the key) → confirm with a code →
// the backup codes, shown once. It applies to password sign-in; a passkey sign-in doesn't ask for it.
import { useMemo, useState, useTransition } from 'react';
import { encode } from 'uqr';
import { authClient } from '@/lib/auth-client';
import { Banner, Button, Chip, field } from '@/components/ui';

const h2 = 'text-lg font-extrabold [font-stretch:110%]';
const section = 'space-y-3 border-t border-line pt-6';
type Note = { kind: 'ok' | 'error'; text: string } | null;

/** The otpauth:// URI as a QR code. Tile colours stay dark on light in both themes, so phones can scan it. */
function QrCode({ text }: { text: string }) {
  const qr = useMemo(() => encode(text, { ecc: 'M', border: 2 }), [text]);
  const d = qr.data.flatMap((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : ''))).join('');
  return (
    <svg role="img" aria-label="QR code for your authenticator app" viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" className="size-48 rounded-callout bg-tile">
      <path d={d} className="fill-tile-ink" />
    </svg>
  );
}

function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-control bg-warn-soft p-3 text-sm text-warn ring-1 ring-warn-ring">
      <p className="font-semibold">Save these backup codes now. They won&apos;t be shown again.</p>
      <p>Each one signs you in once if you lose your authenticator app.</p>
      <ul className="grid grid-cols-2 gap-1 font-mono text-xs text-fg">
        {codes.map((c) => <li key={c} className="rounded-chip bg-surface px-2 py-1">{c}</li>)}
      </ul>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => navigator.clipboard?.writeText(codes.join('\n')).then(() => setCopied(true), () => {})}>{copied ? 'Copied' : 'Copy'}</Button>
        <Button size="sm" variant="primary" onClick={onDone}>I&apos;ve saved them</Button>
      </div>
    </div>
  );
}

const passwordInput = <label className="block text-sm">Your password<input name="password" type="password" required autoComplete="current-password" className={field} /></label>;

export function TwoFactorSection() {
  const session = authClient.useSession();
  const on = !!(session.data?.user as { twoFactorEnabled?: boolean | null } | undefined)?.twoFactorEnabled;
  const [note, setNote] = useState<Note>(null);
  const [setup, setSetup] = useState<{ uri: string; codes: string[] } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [action, setAction] = useState<'regenerate' | 'disable' | null>(null);
  const [pending, start] = useTransition();
  const fail = (e: { message?: string }) => setNote({ kind: 'error', text: e.message ?? 'That didn’t work.' });
  const secret = setup ? new URL(setup.uri).searchParams.get('secret') : null;

  const enable = (f: FormData) => start(async () => {
    const r = await authClient.twoFactor.enable({ password: String(f.get('password') ?? ''), method: 'totp' });
    if (r.error) return fail(r.error);
    if (r.data.method !== 'totp') return;
    setNote(null);
    setSetup({ uri: r.data.totpURI, codes: r.data.backupCodes });
  });
  const verify = (f: FormData) => start(async () => {
    const r = await authClient.twoFactor.verifyTotp({ code: String(f.get('code') ?? '').replace(/\s/g, '') });
    if (r.error) return fail(r.error);
    setCodes(setup!.codes);
    setSetup(null);
    setNote({ kind: 'ok', text: 'Two-factor sign-in is on.' });
    session.refetch();
  });
  const confirmed = (f: FormData) => start(async () => {
    const password = String(f.get('password') ?? '');
    if (action === 'regenerate') {
      const r = await authClient.twoFactor.generateBackupCodes({ password });
      if (r.error) return fail(r.error);
      setCodes(r.data.backupCodes);
      setNote({ kind: 'ok', text: 'New backup codes made. The old ones no longer work.' });
    } else {
      const r = await authClient.twoFactor.disable({ password });
      if (r.error) return fail(r.error);
      setNote({ kind: 'ok', text: 'Two-factor sign-in is off.' });
      session.refetch();
    }
    setAction(null);
  });

  return (
    <section className={section} aria-labelledby="two-factor-h">
      <div className="flex items-center gap-2">
        <h2 id="two-factor-h" className={h2}>Two-factor sign-in</h2>
        {!session.isPending && <Chip tone={on ? 'ok' : 'neutral'}>{on ? 'On' : 'Off'}</Chip>}
      </div>
      <p className="text-sm text-fg-3">After your password, sign-in asks for a code from an authenticator app (1Password, Google Authenticator, Authy…). Passkey sign-in doesn&apos;t need it.</p>
      {note && <Banner kind={note.kind} onDismiss={() => setNote(null)}>{note.text}</Banner>}
      {codes && <BackupCodes codes={codes} onDone={() => setCodes(null)} />}

      {setup ? (
        <form action={verify} className="space-y-3">
          <p className="text-sm text-fg-2">Scan this with your authenticator app, then enter the code it shows.</p>
          <QrCode text={setup.uri} />
          <p className="text-sm text-fg-2">Can&apos;t scan it? <a href={setup.uri} className="text-link hover:underline">Open in an app on this device</a>, or type this key: <code className="break-all rounded-chip bg-muted px-1 font-mono text-xs">{secret}</code></p>
          <label className="block text-sm">Code<input name="code" required inputMode="numeric" pattern="[0-9 ]{6,7}" maxLength={7} autoComplete="one-time-code" className={field} /></label>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={pending}>Turn on</Button>
            <Button variant="ghost" onClick={() => setSetup(null)}>Cancel</Button>
          </div>
        </form>
      ) : !on ? (
        !session.isPending && (
          <form action={enable} className="max-w-sm space-y-3">
            {passwordInput}
            <Button type="submit" loading={pending}>Set up two-factor</Button>
          </form>
        )
      ) : action ? (
        <form action={confirmed} className="max-w-sm space-y-3">
          {passwordInput}
          <div className="flex gap-2">
            <Button type="submit" variant={action === 'disable' ? 'danger' : 'primary'} loading={pending}>{action === 'disable' ? 'Turn off two-factor' : 'Make new backup codes'}</Button>
            <Button variant="ghost" onClick={() => setAction(null)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setAction('regenerate')}>New backup codes</Button>
          <Button variant="danger-link" onClick={() => setAction('disable')}>Turn off</Button>
        </div>
      )}
    </section>
  );
}
