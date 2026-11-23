// The auth emails: subject, plain text and a simple HTML version. Names come from users, so the HTML escapes them.
import { APP_NAME } from '../brand';

export type AuthEmailKind = 'reset-password' | 'verify-email' | 'invitation' | 'magic-link';
export type AuthEmailInput = { to: string; url: string; name?: string | null; inviter?: string | null; collection?: string | null };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function authEmail(kind: AuthEmailKind, m: AuthEmailInput): { subject: string; text: string; html: string } {
  const hi = m.name?.trim() ? `Hi ${m.name.trim()},` : 'Hi,';
  const who = m.inviter?.trim() || 'Someone';
  const what = m.collection?.trim() ? `the collection "${m.collection.trim()}"` : `their ${APP_NAME}`;
  const t = {
    'reset-password': {
      subject: `Reset your ${APP_NAME} password`,
      lines: [`Someone asked to reset the password for ${m.to}. Choose a new one here:`],
      button: 'Reset password',
      after: "The link works once and expires soon. If you didn't ask for this, ignore this email; your password stays the same.",
    },
    'verify-email': {
      subject: `Confirm your email for ${APP_NAME}`,
      lines: [`Confirm that ${m.to} is your address:`],
      button: 'Confirm email',
      after: "If you didn't sign up, ignore this email.",
    },
    invitation: {
      subject: `${who} invited you to ${m.collection?.trim() ? m.collection.trim() : APP_NAME}`,
      lines: [`${who} invited you to ${what} on ${APP_NAME}. Accept here:`],
      button: 'Accept invitation',
      after: "If you weren't expecting this, ignore this email.",
    },
    'magic-link': {
      subject: `Sign in to ${APP_NAME}`,
      lines: [`Use this link to sign in as ${m.to}:`],
      button: 'Sign in',
      after: "The link works once and expires soon. If you didn't ask for it, ignore this email.",
    },
  }[kind];
  if (!t) throw new Error(`Unknown email kind: ${kind}`);

  const text = [hi, '', ...t.lines, m.url, '', t.after, '', `— ${APP_NAME}`].join('\n');
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
<p>${esc(hi)}</p>
${t.lines.map((l) => `<p>${esc(l)}</p>`).join('\n')}
<p><a href="${esc(m.url)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px">${esc(t.button)}</a></p>
<p style="font-size:13px;color:#555">Or paste this link into your browser:<br>${esc(m.url)}</p>
<p style="font-size:13px;color:#555">${esc(t.after)}</p>
<p style="font-size:13px;color:#555">— ${esc(APP_NAME)}</p>
</body></html>`;
  return { subject: t.subject, text, html };
}
