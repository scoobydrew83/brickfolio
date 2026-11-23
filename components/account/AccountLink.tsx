import Link from 'next/link';
import { connection } from 'next/server';
import { UserRound } from 'lucide-react';
import { authMode } from '@/lib/auth';

/** The header's link to /account (#90 phase 2): only with AUTH_MODE=better-auth, where there's an account to manage. */
export async function AccountLink() {
  await connection(); // AUTH_MODE is read per request
  if (authMode() !== 'better-auth') return null;
  return (
    <Link href="/account" aria-label="Your account" title="Your account" className="flex size-9 shrink-0 items-center justify-center rounded-control text-on-header hover:bg-white/10 hover:text-white">
      <UserRound aria-hidden className="size-4" />
    </Link>
  );
}
