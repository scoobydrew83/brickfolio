// Accepting an invitation (#90 phase 2). Public like /sign-in: the invited person may not have an account yet. The
// link only says which invitation; accepting needs a session whose verified address is the invited one (see
// lib/service/invitations.ts).
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { InviteActions } from '@/components/account/InviteActions';
import { InviteSignIn, SignOutButton } from '@/components/account/InviteSignIn';
import { authMode } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { emailConfigured } from '@/lib/email';
import { currentUser } from '@/lib/session';

export const metadata = { title: 'Invitation', referrer: 'no-referrer' };

const GONE = {
  expired: 'This invitation has expired. Ask whoever invited you for a new one.',
  accepted: 'This invitation has already been accepted.',
  canceled: 'This invitation was cancelled.',
  rejected: 'This invitation was declined.',
};

export default async function InvitePage({ params }: PageProps<'/invite/[id]'>) {
  await connection();
  if (authMode() !== 'better-auth') redirect('/');
  const { id } = await params;
  const { getInvite } = await import('@/lib/service/invitations');
  const [info, user] = await Promise.all([getInvite(await getDb(), id), currentUser()]);
  return (
    <main className="mx-auto max-w-sm space-y-4 px-4 py-16">
      <h1 className="text-2xl font-extrabold [font-stretch:110%]">Brickfolio</h1>
      {!info ? <p className="text-sm text-fg-2">This invitation doesn&apos;t exist. Check the link, or ask for a new one.</p>
        : info.state !== 'pending' ? <p className="text-sm text-fg-2">{GONE[info.state]}</p>
        : (
          <>
            <p className="text-sm text-fg-2"><b>{info.inviter}</b> invited <b className="break-all">{info.email}</b> to the collection <b>{info.collection}</b> as {info.role}.</p>
            {user?.user === info.email ? <InviteActions id={info.id} collection={info.collection} />
              : user ? (
                <div className="space-y-3 text-sm text-fg-2">
                  <p>You&apos;re signed in as <b className="break-all">{user.user}</b>. Sign out and sign in as {info.email} to accept.</p>
                  <SignOutButton />
                </div>
              ) : <InviteSignIn id={info.id} email={info.email} canSignUp={emailConfigured()} />}
          </>
        )}
    </main>
  );
}
