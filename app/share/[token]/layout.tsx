import { APP_NAME } from '@/lib/brand';
import { Logo } from '@/components/ui';
import { ThemeToggle } from '@/components/shell/ThemeToggle';

export const metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' as const };

/** A shared collection: brand and theme toggle only. No nav, no scan button, no links into the app. */
export default function ShareLayout({ children }: LayoutProps<'/share/[token]'>) {
  return (
    <>
      <header className="bg-header text-on-header">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-2.5 px-4 py-2.5 sm:px-6">
          <Logo />
          <span className="flex-1 text-lg font-bold tracking-tight text-white [font-stretch:110%]">{APP_NAME}</span>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-6 pb-10 sm:px-6">{children}</main>
    </>
  );
}
