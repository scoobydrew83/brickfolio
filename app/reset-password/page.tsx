// A new password from a reset link (#90). Better Auth checks the link's token and sends the browser here with
// `?token=…` (or `?error=INVALID_TOKEN`). Without a token: ask for a link by email, when email is set up.
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { authMode } from '@/lib/auth';
import { emailConfigured } from '@/lib/email';
import { ResetForm } from './ResetForm';

export const metadata = { title: 'Reset password', referrer: 'no-referrer' };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  await connection();
  if (authMode() !== 'better-auth') redirect('/');
  const { token, error } = await searchParams;
  return (
    <main className="mx-auto max-w-sm space-y-4 px-4 py-16">
      <h1 className="text-2xl font-extrabold [font-stretch:110%]">Reset password</h1>
      <ResetForm token={typeof token === 'string' ? token : null} invalid={!!error} canEmail={emailConfigured()} />
    </main>
  );
}
