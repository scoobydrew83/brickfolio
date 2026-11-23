// The second step of password sign-in when two-factor is on (#90 phase 2): a code from the authenticator app, or a
// backup code. The client's twoFactorClient sends the browser here (lib/auth-client.ts); the pending sign-in is a
// signed cookie that lasts 10 minutes. Outside the app layout, like /sign-in.
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { authMode } from '@/lib/auth';
import { TwoFactorForm } from './TwoFactorForm';

export const metadata = { title: 'Two-factor sign-in' };

export default async function TwoFactorPage() {
  await connection(); // AUTH_MODE is read at request time, not build time
  if (authMode() !== 'better-auth') redirect('/');
  return (
    <main className="mx-auto max-w-sm space-y-4 px-4 py-16">
      <h1 className="text-2xl font-extrabold [font-stretch:110%]">Two-factor sign-in</h1>
      <TwoFactorForm />
    </main>
  );
}
