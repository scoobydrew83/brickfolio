// Your account (#90 phase 2): name, password, sessions and sign-in methods. Only with AUTH_MODE=better-auth; behind
// Tailscale or Cloudflare Access the sign-in is theirs, so the page just says who you are and where that's managed.
import { Suspense } from 'react';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import Link from 'next/link';
import { PageSkeleton } from '@/components/ui';
import { PageHeader } from '@/components/shell/PageHeader';
import AccountView from '@/components/account/AccountView';
import { authMode } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { currentUser } from '@/lib/session';

export const metadata = { title: 'Account' };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Suspense fallback={<PageSkeleton />}>
        <Content />
      </Suspense>
    </div>
  );
}

const MANAGED: Record<string, string> = {
  none: 'There is no sign-in (AUTH_MODE=none), so there is no account to manage.',
  tailscale: 'You sign in through Tailscale: your login, devices and sessions are managed in Tailscale.',
  'cloudflare-access': 'You sign in through Cloudflare Access: your login and sessions are managed there.',
};

async function Content() {
  await connection();
  const mode = authMode();
  const user = await currentUser();
  if (!user) return <p className="py-24 text-center text-fg-3">Not signed in.</p>;
  if (mode !== 'better-auth') {
    return (
      <div className="space-y-4">
        <PageHeader title="Account" />
        <p className="text-sm text-fg-2">Signed in as <b className="break-all">{user.user}</b>. {MANAGED[mode]}</p>
        <p className="text-sm text-fg-3">API tokens are in <Link href="/settings" className="text-link underline-offset-2 hover:underline">Settings</Link>.</p>
      </div>
    );
  }
  const { accountInfo } = await import('@/lib/account');
  const info = await accountInfo(await getDb(), await headers());
  if (!info) return <p className="py-24 text-center text-fg-3">Not signed in.</p>;
  return <AccountView info={info} />;
}
