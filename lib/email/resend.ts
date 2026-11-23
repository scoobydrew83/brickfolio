// Resend: https://resend.com/docs/api-reference/emails/send-email (POST /emails, Bearer key).
import { clean, EmailError, errorText, postJson, type EmailProvider } from './types';

export const resend: EmailProvider = {
  missing: (env) => (env.RESEND_API_KEY ? [] : ['RESEND_API_KEY']),
  async send(msg, from, env) {
    const key = env.RESEND_API_KEY!;
    const { res, body } = await postJson('resend', 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
    });
    if (!res.ok) throw new EmailError('resend', `HTTP ${res.status}${detail(body, key)}`);
  },
};

const detail = (body: unknown, key: string) => {
  const t = clean(errorText(body, ['message', 'error']), [key]);
  return t ? `: ${t}` : '';
};
