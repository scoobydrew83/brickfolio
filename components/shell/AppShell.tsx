import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { getDb } from '@/lib/db';
import { underTargetCount } from '@/lib/service/alerts';
import { cachedUpdateStatus } from '@/lib/service/updates';
import { currentAccess, currentSelection, currentUser } from '@/lib/session';
import { listCollections } from '@/lib/service/collections';
import { CollectionSwitcher } from './CollectionSwitcher';
import { APP_NAME } from '@/lib/brand';
import { INSTALL_URL, isDemo } from '@/lib/demo';
import { ScanBarcode } from 'lucide-react';
import { Logo, Tip } from '../ui';
import { TooltipProvider } from '../ui/tooltip';
import { Nav } from '../Nav';
import { ThemeToggle } from './ThemeToggle';
import { AccountLink } from '../account/AccountLink';
import { MobileMenu } from './MobileMenu';
import { CommandPaletteMount } from './CommandPaletteMount';
import { authMode } from '@/lib/auth';
import { ImpersonationBar } from './ImpersonationBar';
import { DbCheck } from './DbCheck';

/** Shell shared by every page: brand, page links, theme toggle. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    // One TooltipProvider for every page in the shell: the shared hover delay. timeout={0} turns off Base UI's
    // "next tip opens instantly" phase, which with our controlled <Tip> left the next tip open but not shown (#104).
    // <Tip> works without a provider too (the share page and sign-in pages are outside the shell).
    <TooltipProvider delay={400} timeout={0}>
      <header className="sticky top-0 z-30 bg-header text-on-header">
        <div className="group/header mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-2.5 sm:px-6 lg:gap-4 xl:gap-6">
          <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight text-on-header-strong">
            <Logo />
            {/* With the collection switcher, the wordmark gives way to the nav between phone and wide widths; the logo stays. */}
            <span className="text-lg [font-stretch:110%] sm:max-xl:group-has-[[data-switcher]]/header:sr-only">{APP_NAME}</span>
          </Link>
          <div className="flex-1"><Suspense fallback={<Nav />}><NavWithAlerts /></Suspense></div>
          <Tip label="Scan a barcode" side="bottom">
            <Link href="/scan" aria-label="Scan a barcode" className="-my-1 rounded-control p-2 text-on-header hover:bg-header-hover hover:text-on-header-strong sm:hidden">
              <ScanBarcode aria-hidden className="size-5" />
            </Link>
          </Tip>
          <Suspense fallback={null}><CommandPaletteMount /></Suspense>
          <Suspense fallback={null}><Switcher /></Suspense>
          {/* On phones the theme switch and account link are in the menu. */}
          <div className="hidden sm:contents"><ThemeToggle /></div>
          <Suspense fallback={null}><AccountLink /></Suspense>
          <Suspense fallback={<MobileMenu />}><NavWithAlerts variant="menu" /></Suspense>
        </div>
      </header>
      <Suspense fallback={null}><DbCheck /></Suspense>
      <Suspense fallback={null}><ImpersonationBar /></Suspense>
      <Suspense fallback={null}><DemoNotice /></Suspense>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-6 pb-10 sm:px-6">{children}</main>
    </TooltipProvider>
  );
}

/** The nav (header row from 640px, or the phone menu) with the count of wishlist sets under target. Never blocks or breaks the page. */
async function NavWithAlerts({ variant = 'top' }: { variant?: 'top' | 'menu' }) {
  const user = await currentUser().catch(() => null); // a broken database must not take the header down (DbCheck explains it)
  const alerts = user ? await getDb().then(underTargetCount).catch(() => 0) : 0;
  // Only the stored answer: the nav never waits on GitHub.
  const access = user ? await currentAccess().catch(() => null) : null;
  // The update dot is for admins, who can update the server (#50).
  const update = access?.admin ? await getDb().then(cachedUpdateStatus).then((u) => u.updateAvailable).catch(() => false) : false;
  const admin = access?.admin ?? true;
  if (variant === 'menu') {
    await connection(); // AUTH_MODE is read per request
    return <MobileMenu alerts={alerts} update={update} admin={admin} account={authMode() === 'better-auth'} />;
  }
  return <Nav alerts={alerts} update={update} admin={admin} />;
}

/** The collection switcher (#49), only once there are two or more collections. Never breaks the page. */
async function Switcher() {
  await connection();
  const access = await currentAccess().catch(() => null);
  if (!access) return null;
  // Only the collections this person can see (#50); "All" means all of those.
  const collections = (await getDb().then(listCollections).catch(() => [])).filter((c) => access.admin || access.roles.has(c.id));
  if (collections.length < 2) return null;
  const sel = await currentSelection().catch(() => 'all' as const);
  return <CollectionSwitcher collections={collections} current={sel !== 'all' && collections.some((c) => c.id === sel) ? sel : 'all'} />;
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
