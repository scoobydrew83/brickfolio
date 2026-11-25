import Link from 'next/link';
import { connection } from 'next/server';
import { UserRound } from 'lucide-react';
import { authMode } from '@/lib/auth';
import { Tip } from '../ui';

/** The header's link to /account (#90 phase 2): only with AUTH_MODE=better-auth, where there's an account to manage. On phones it's in the menu. */
export async function AccountLink() {
  await connection(); // AUTH_MODE is read per request
  if (authMode() !== 'better-auth') return null;
  return (
    <Tip label="Your account" side="bottom">
      <Link href="/account" aria-label="Your account" className="hidden size-9 shrink-0 items-center justify-center rounded-control text-on-header hover:bg-header-hover hover:text-on-header-strong sm:flex">
        <UserRound aria-hidden className="size-4" />
      </Link>
    </Tip>
  );
}
