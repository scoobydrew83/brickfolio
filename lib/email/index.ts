// Transactional email (password reset, email verification, invitations, sign-in links) for Better Auth (#90).
// EMAIL_PROVIDER picks the provider, EMAIL_FROM the sender ("Brickfolio <noreply@example.com>"). Nothing here logs
// message bodies or links: reset and sign-in links are secrets.
//
// Adding a provider: write lib/email/<name>.ts exporting an EmailProvider (types.ts), add it to PROVIDERS below, and
// document its variables in .env.example and docs/install.md.
import 'server-only';
import { cloudflare } from './cloudflare';
import { postmark } from './postmark';
import { resend } from './resend';
import { ses } from './ses';
import { smtp } from './smtp';
import { authEmail, type AuthEmailInput, type AuthEmailKind } from './templates';
import { EmailError, type EmailEnv, type EmailMessage, type EmailProvider } from './types';

export type { EmailEnv, EmailMessage } from './types';
export type { AuthEmailKind } from './templates';
export { EmailError } from './types';

const PROVIDERS: Record<string, EmailProvider> = { smtp, resend, ses, postmark, cloudflare };
export const EMAIL_PROVIDERS = Object.keys(PROVIDERS);

const providerName = (env: EmailEnv) => (env.EMAIL_PROVIDER ?? '').trim().toLowerCase();

/** What's set up: the provider, and what's missing (empty when it can send). */
export function emailStatus(env: EmailEnv = process.env): { provider: string | null; missing: string[] } {
  const name = providerName(env);
  if (!name) return { provider: null, missing: ['EMAIL_PROVIDER'] };
  const p = PROVIDERS[name];
  if (!p) return { provider: name, missing: [`EMAIL_PROVIDER must be one of ${EMAIL_PROVIDERS.join(', ')}`] };
  return { provider: name, missing: [...(env.EMAIL_FROM?.trim() ? [] : ['EMAIL_FROM']), ...p.missing(env)] };
}

/** True when EMAIL_PROVIDER (and its keys) are set. */
export function emailConfigured(env: EmailEnv = process.env): boolean {
  return emailStatus(env).missing.length === 0;
}

/** Sends one email. Throws an Error with a readable message (the provider's own error text, no secrets) on failure. */
export async function sendEmail(msg: EmailMessage, env: EmailEnv = process.env): Promise<void> {
  const { provider, missing } = emailStatus(env);
  if (missing.length) throw new EmailError(provider ?? 'email', `not set up (${missing.join(', ')})`);
  const to = msg.to.trim();
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+$/.test(to)) throw new EmailError(provider!, 'the recipient is not a valid email address');
  const subject = msg.subject.replace(/[\r\n]+/g, ' ').trim();
  await PROVIDERS[provider!].send({ ...msg, to, subject }, env.EMAIL_FROM!.trim(), env);
}

/** Sends one of the auth emails (subject + plain text + simple HTML built here). Throws an Error with a readable message on failure. */
export async function sendAuthEmail(kind: AuthEmailKind, msg: AuthEmailInput, env: EmailEnv = process.env): Promise<void> {
  await sendEmail({ to: msg.to, ...authEmail(kind, msg) }, env);
}
