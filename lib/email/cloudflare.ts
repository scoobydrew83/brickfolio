// Cloudflare Email Service (Email Sending, public beta since 2026-04-16; sending to any address needs Workers Paid and a
// domain onboarded under Email Service → Email Sending). Two ways in:
// - REST API, from any host: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_EMAIL_API_TOKEN →
//   POST https://api.cloudflare.com/client/v4/accounts/{id}/email/sending/send
//   https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
// - Workers binding (no token): a `send_email` binding named EMAIL (or EMAIL_BINDING) in wrangler.jsonc, read through
//   getCloudflareContext() like lib/db/d1.ts reads D1. env.EMAIL.send({ from, to, subject, text, html }).
//   https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
// The REST API wins when both are set.
import { clean, EmailError, errorText, onWorkers, parseAddress, postJson, type EmailEnv, type EmailProvider } from './types';

type SendEmailBinding = { send(m: Record<string, unknown>): Promise<{ messageId?: string }> };

const rest = (env: EmailEnv) => Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_EMAIL_API_TOKEN);
const bindingName = (env: EmailEnv) => env.EMAIL_BINDING || 'EMAIL';

/** The binding, when OpenNext has put the Cloudflare context on the global scope (as getCloudflareContext() reads it). */
function peekBinding(env: EmailEnv): SendEmailBinding | undefined {
  const ctx = (globalThis as Record<symbol, { env?: Record<string, unknown> } | undefined>)[Symbol.for('__cloudflare-context__')];
  return ctx?.env?.[bindingName(env)] as SendEmailBinding | undefined;
}

export const cloudflare: EmailProvider = {
  missing(env) {
    if (rest(env)) return [];
    if (onWorkers(env)) return peekBinding(env) || !globalCtx() ? [] : [`a send_email binding named ${bindingName(env)}`];
    return ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_EMAIL_API_TOKEN'].filter((k) => !env[k]);
  },
  async send(msg, from, env) {
    if (rest(env)) return sendRest(msg, from, env);
    let binding: SendEmailBinding | undefined;
    try {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare');
      binding = (getCloudflareContext().env as unknown as Record<string, SendEmailBinding | undefined>)[bindingName(env)];
    } catch {
      binding = undefined;
    }
    if (!binding) {
      throw new EmailError('cloudflare', `no send_email binding named ${bindingName(env)}; add it to wrangler.jsonc, or set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_EMAIL_API_TOKEN to use the REST API`);
    }
    const sender = parseAddress(from);
    try {
      await binding.send({
        from: sender.name ? { email: sender.email, name: sender.name } : sender.email,
        to: msg.to, subject: msg.subject, text: msg.text, html: msg.html,
      });
    } catch (e) {
      const err = e as Error & { code?: string };
      throw new EmailError('cloudflare', `${err.code ? `${err.code}: ` : ''}${clean(err.message ?? String(e), [])}`);
    }
  },
};

// Only used to tell "context not set up yet" (e.g. at build time) from "binding missing".
const globalCtx = () => (globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')];

async function sendRest(msg: Parameters<EmailProvider['send']>[0], from: string, env: EmailEnv) {
  const token = env.CLOUDFLARE_EMAIL_API_TOKEN!;
  const sender = parseAddress(from);
  const { res, body } = await postJson('cloudflare', `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID!)}/email/sending/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: sender.name ? { address: sender.email, name: sender.name } : sender.email,
      to: msg.to, subject: msg.subject, text: msg.text, html: msg.html,
    }),
  });
  const b = (body && typeof body === 'object' ? body : {}) as { success?: boolean; result?: { permanent_bounces?: string[] } | null };
  if (!res.ok || b.success === false) {
    const t = clean(errorText(body, ['errors', 'message']), [token]);
    throw new EmailError('cloudflare', `HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  if (b.result?.permanent_bounces?.length) throw new EmailError('cloudflare', 'the recipient address bounced permanently');
}
