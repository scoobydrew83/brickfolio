'use client';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Banner, Button } from '@/components/ui';

type Props = { client: { name: string; uri: string | null }; account: string; scopes: { id: string; text: string }[]; redirectHost: string | null };

/** Allow or Deny; Better Auth answers with where to send the browser (back to the client, with a code or an error). */
export function ConsentForm({ client, account, scopes, redirectHost }: Props) {
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const answer = async (accept: boolean) => {
    setBusy(accept ? 'allow' : 'deny');
    setError(null);
    // oauthProviderClient (lib/auth-client.ts) adds the signed request from this page's address.
    const r = await authClient.$fetch<{ url?: string; uri?: string }>('/oauth2/consent', { method: 'POST', body: { accept } });
    const to = r.data?.url ?? r.data?.uri;
    if (to) return window.location.assign(to);
    setBusy(null);
    setError(r.error?.message ?? 'That didn’t work. Go back to the app and connect again.');
  };
  return (
    <div className="space-y-4">
      {error && <Banner kind="error">{error}</Banner>}
      <p className="text-fg-2">
        <b className="text-fg">{client.name}</b>{client.uri ? <> (<span className="break-all">{client.uri}</span>)</> : null} wants to use Brickfolio as <b className="text-fg">{account}</b>. It will be able to:
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-fg-2">
        {scopes.map((s) => <li key={s.id}>{s.text}</li>)}
      </ul>
      <p className="text-xs text-fg-3">
        It sees only the collections you can see, with your role.{redirectHost ? ` You’ll be sent back to ${redirectHost}.` : ''} Only allow apps you trust.
      </p>
      <div className="flex gap-2">
        <Button variant="primary" loading={busy === 'allow'} disabled={!!busy} onClick={() => answer(true)}>Allow</Button>
        <Button variant="ghost" loading={busy === 'deny'} disabled={!!busy} onClick={() => answer(false)}>Deny</Button>
      </div>
    </div>
  );
}
