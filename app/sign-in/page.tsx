// Sign-in (and the first account's sign-up) for AUTH_MODE=better-auth (#90). Outside the app layout: no nav until
// someone is signed in. Google, GitHub and Apple buttons appear for the providers with keys set; an emailed sign-in
// link when email is set up. Provider callbacks and sign-in links send errors back here as `?error=<code>`.
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { authMode } from '@/lib/auth';
import { configuredProviders, PROVIDER_NAMES } from '@/lib/better-auth';
import { emailConfigured } from '@/lib/email';
import { signInError } from './errors';
import { SignInForm } from './SignInForm';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  await connection(); // AUTH_MODE is read at request time, not build time
  if (authMode() !== 'better-auth') redirect('/');
  const { error } = await searchParams;
  const mail = emailConfigured();
  return (
    <main className="mx-auto max-w-sm space-y-4 px-4 py-16">
      <h1 className="text-2xl font-extrabold [font-stretch:110%]">Brickfolio</h1>
      <SignInForm
        canReset={mail}
        canEmailLink={mail}
        providers={configuredProviders().map((id) => ({ id, name: PROVIDER_NAMES[id] }))}
        initialError={signInError(typeof error === 'string' ? error : null)}
      />
    </main>
  );
}
