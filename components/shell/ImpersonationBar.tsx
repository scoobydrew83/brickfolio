import { connection } from 'next/server';
import { headers } from 'next/headers';
import { authMode } from '@/lib/auth';
import { StopActing } from './StopActing';

/**
 * While an admin acts as someone (#102): a strip under the header on every page, read from the session server-side,
 * with Stop. Better Auth only; never breaks the page.
 */
export async function ImpersonationBar() {
  await connection();
  if (authMode() !== 'better-auth') return null;
  const [{ getDb }, { getAuth }] = await Promise.all([import('@/lib/db'), import('@/lib/better-auth')]);
  const db = await getDb().catch(() => null); // a broken database must not take the header down
  if (!db) return null;
  const s = await getAuth(db).api.getSession({ headers: await headers() }).catch(() => null);
  if (!(s?.session as { impersonatedBy?: string | null } | undefined)?.impersonatedBy) return null;
  const name = s!.user.name && s!.user.name !== s!.user.email ? s!.user.name : null;
  return (
    <div role="status" className="border-b border-warn-ring bg-warn-soft px-4 py-1.5 text-center text-sm text-warn">
      You&apos;re acting as <span className="font-semibold break-all">{name ? `${name} (${s!.user.email})` : s!.user.email}</span>. <StopActing />
    </div>
  );
}
