// SMTP through nodemailer, loaded only when used. Workers have no raw TCP sockets for it, so it's refused there.
import { clean, EmailError, onWorkers, TIMEOUT_MS, type EmailProvider } from './types';

export const SMTP_ON_WORKERS = "SMTP doesn't run on Cloudflare Workers; use resend, ses, postmark or cloudflare";

const yes = (v?: string) => /^(1|true|yes|on)$/i.test(v ?? '');

export const smtp: EmailProvider = {
  missing: (env) => (onWorkers(env) ? [SMTP_ON_WORKERS] : env.SMTP_HOST ? [] : ['SMTP_HOST']),
  async send(msg, from, env) {
    if (onWorkers(env)) throw new EmailError('smtp', SMTP_ON_WORKERS);
    const port = Number(env.SMTP_PORT) || (yes(env.SMTP_SECURE) ? 465 : 587);
    const { createTransport } = await import('nodemailer');
    const transport = createTransport({
      host: env.SMTP_HOST,
      port,
      secure: env.SMTP_SECURE ? yes(env.SMTP_SECURE) : port === 465, // false: STARTTLS when the server offers it
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
      connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS,
      logger: false, debug: false,
    });
    try {
      await transport.sendMail({ from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    } catch (e) {
      throw new EmailError('smtp', clean((e as Error).message, [env.SMTP_PASSWORD, env.SMTP_USER]));
    } finally {
      transport.close();
    }
  },
};
