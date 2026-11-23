// Postmark: https://postmarkapp.com/developer/api/email-api (POST /email, X-Postmark-Server-Token).
// POSTMARK_MESSAGE_STREAM picks a stream other than the default transactional one ("outbound").
import { clean, EmailError, errorText, postJson, type EmailProvider } from './types';

export const postmark: EmailProvider = {
  missing: (env) => (env.POSTMARK_SERVER_TOKEN ? [] : ['POSTMARK_SERVER_TOKEN']),
  async send(msg, from, env) {
    const token = env.POSTMARK_SERVER_TOKEN!;
    const { res, body } = await postJson('postmark', 'https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': token },
      body: JSON.stringify({
        From: from, To: msg.to, Subject: msg.subject, TextBody: msg.text, HtmlBody: msg.html,
        MessageStream: env.POSTMARK_MESSAGE_STREAM || 'outbound',
      }),
    });
    const code = body && typeof body === 'object' ? (body as { ErrorCode?: number }).ErrorCode : undefined;
    if (!res.ok || (code !== undefined && code !== 0)) {
      const t = clean(errorText(body, ['Message']), [token]);
      throw new EmailError('postmark', `HTTP ${res.status}${code ? ` (code ${code})` : ''}${t ? `: ${t}` : ''}`);
    }
  },
};
