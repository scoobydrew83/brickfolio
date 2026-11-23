// Shared types and helpers for the email providers (one file per provider in lib/email/).
export type EmailEnv = Record<string, string | undefined>;

export type EmailMessage = { to: string; subject: string; text: string; html: string };

/** A provider: which env it needs (names of missing variables, or a reason it can't run here) and how it sends. */
export type EmailProvider = {
  /** Names of required variables that are unset, plus anything else that stops it working (e.g. "runs on Workers"). */
  missing(env: EmailEnv): string[];
  /** Sends one message. `from` is EMAIL_FROM. Throws EmailError on failure. */
  send(msg: EmailMessage, from: string, env: EmailEnv): Promise<void>;
};

export const TIMEOUT_MS = 10_000;

export class EmailError extends Error {
  constructor(provider: string, detail: string) {
    super(`Email via ${provider} failed: ${detail}`);
    this.name = 'EmailError';
  }
}

/** True on Cloudflare Workers (the documented user agent), or when the app is set up for D1. */
export const onWorkers = (env: EmailEnv) =>
  env.DB_DRIVER === 'd1' || (typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers');

/** Splits "Name <a@b>" into its parts; a bare address has no name. */
export function parseAddress(from: string): { email: string; name?: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { email: m[2].trim(), ...(m[1].trim() ? { name: m[1].trim() } : {}) } : { email: from.trim() };
}

/** Keeps a provider's error text short and free of anything secret (the message's link, keys) before it's thrown. */
export function clean(text: string, secrets: (string | undefined)[]): string {
  let out = text.replace(/\s+/g, ' ').trim();
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('[redacted]');
  // Links can carry tokens even when they aren't ours verbatim (e.g. URL-encoded).
  out = out.replace(/https?:\/\/\S+/g, '[link]');
  return out.length > 300 ? `${out.slice(0, 300)}…` : out;
}

/** POSTs JSON with a 10 s timeout; returns the response and its body (parsed JSON when it is JSON). */
export async function postJson(provider: string, req: Request | string, init: RequestInit = {}): Promise<{ res: Response; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(req, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const err = e as Error;
    if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new EmailError(provider, `no answer within ${TIMEOUT_MS / 1000} s`);
    throw new EmailError(provider, `couldn't connect (${err.message})`);
  }
  const raw = await res.text().catch(() => '');
  let body: unknown = raw;
  try { body = raw ? JSON.parse(raw) : null; } catch { /* not JSON: keep the text */ }
  return { res, body };
}

/** The error text a provider put in its answer: the first string found under these keys, else the raw text. */
export function errorText(body: unknown, keys: string[]): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    for (const k of keys) {
      const v = o[k];
      if (typeof v === 'string' && v) return v;
      if (Array.isArray(v)) {
        const msgs = v.map((x) => (x && typeof x === 'object' ? (x as { message?: unknown }).message : x)).filter((x) => typeof x === 'string' && x);
        if (msgs.length) return msgs.join('; ');
      }
    }
  }
  return '';
}
