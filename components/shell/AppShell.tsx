import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { getDb } from '@/lib/db';
import { underTargetCount } from '@/lib/service/alerts';
import { currentUser } from '@/lib/session';
import { APP_NAME } from '@/lib/brand';
import { INSTALL_URL, isDemo } from '@/lib/demo';
import { Logo } from '../ui';
import { Nav } from '../Nav';
import { ThemeToggle } from './ThemeToggle';

/** Shell shared by every page: brand, page links, theme toggle. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-30 bg-header text-on-header">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-6 px-4 py-2.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight text-white">
            <Logo />
            <span className="text-lg [font-stretch:110%]">{APP_NAME}</span>
          </Link>
          <div className="flex-1"><Suspense fallback={<Nav />}><NavWithAlerts /></Suspense></div>
          <ThemeToggle />
        </div>
      </header>
      <Suspense fallback={null}><DemoNotice /></Suspense>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-6 pb-28 sm:px-6 sm:pb-10">{children}</main>
      <Suspense fallback={<Nav variant="bottom" />}><NavWithAlerts variant="bottom" /></Suspense>
    </>
  );
}

/** The nav with the count of wishlist sets under target. Never blocks or breaks the page. */
async function NavWithAlerts({ variant }: { variant?: 'top' | 'bottom' }) {
  const alerts = (await currentUser()) ? await getDb().then(underTargetCount).catch(() => 0) : 0;
  return <Nav variant={variant} alerts={alerts} />;
}

/** DEMO_MODE=on: a strip under the header. Read per request, so the same build serves both. */
async function DemoNotice() {
  await connection();
  if (!isDemo()) return null;
  return (
    <p className="bg-primary px-4 py-1.5 text-center text-sm text-on-primary">
      Demo with sample data. Changes are switched off.{' '}
      <a href={INSTALL_URL} className="font-bold underline underline-offset-2">Install your own →</a>
    </p>
  );
}
