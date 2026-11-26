// Approving an MCP client (Claude, an editor…) that asked to use Brickfolio for you (OAuth, AUTH_MODE=better-auth).
// Better Auth sends people here from /api/auth/oauth2/authorize with a signed copy of the client's request; this shows
// who is asking and for what, and the buttons send the answer back (ConsentForm). The answer is only accepted with a
// valid, unexpired signature: Better Auth checks it on /oauth2/consent, so a forged page can't approve anything.
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { authMode } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { authOAuthClient } from '@/lib/db/schema';
import { ConsentForm } from './ConsentForm';

export const metadata = { title: 'Allow access' };

/** What each scope lets the client do, in plain words. */
const SCOPE_TEXT: Record<string, string> = {
  'mcp:read': 'Read your collection, wishlist, parts and prices',
  'mcp:write': 'Add and change sets, copies and the wishlist (only if the server allows MCP writes)',
  offline_access: 'Stay connected without asking again until you revoke it',
  openid: 'Know which Brickfolio account you are',
  profile: 'See your name',
  email: 'See your email address',
};

export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  if (authMode() !== 'better-auth') redirect('/');
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');
  const valid = !!one('sig') && !!one('client_id');
  const db = await getDb();
  const client = valid ? await db.select({ name: authOAuthClient.name, uri: authOAuthClient.uri, disabled: authOAuthClient.disabled }).from(authOAuthClient).where(eq(authOAuthClient.clientId, one('client_id'))).get() : undefined;
  const { getAuth } = await import('@/lib/better-auth');
  const session = await getAuth(db).api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-16">
      <h1 className="text-2xl font-extrabold [font-stretch:110%]">Allow access to Brickfolio?</h1>
      {!valid || !client || client.disabled ? (
        <p className="text-fg-3">This request has expired or isn’t valid. Go back to the app that asked and connect again.</p>
      ) : (
        <ConsentForm
          client={{ name: client.name || 'An app', uri: client.uri ?? null }}
          account={session.user.email}
          scopes={one('scope').split(/\s+/).filter(Boolean).map((s) => ({ id: s, text: SCOPE_TEXT[s] ?? s }))}
          redirectHost={(() => { try { return new URL(one('redirect_uri')).host || null; } catch { return null; } })()}
        />
      )}
    </main>
  );
}
