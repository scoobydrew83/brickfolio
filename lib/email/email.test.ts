// Email providers with a fake fetch: request shape per provider, error handling, emailConfigured().
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailConfigured, emailStatus, sendAuthEmail, sendEmail } from './index';
import { authEmail } from './templates';
import { parseAddress } from './types';

vi.mock('server-only', () => ({}));
const sendMail = vi.fn();
vi.mock('nodemailer', () => ({ createTransport: vi.fn(() => ({ sendMail, close: () => {} })) }));

type Call = { url: string; method: string; headers: Headers; body: string };
let calls: Call[] = [];
let reply: () => Response;

beforeEach(() => {
  calls = [];
  reply = () => Response.json({ id: 'x' });
  vi.stubGlobal('fetch', async (input: Request | string, init?: RequestInit) => {
    const req = new Request(input, init);
    calls.push({ url: req.url, method: req.method, headers: req.headers, body: await req.text() });
    expect(init?.signal ?? req.signal).toBeTruthy(); // every request has the 10 s timeout
    return reply();
  });
});
afterEach(() => { vi.unstubAllGlobals(); sendMail.mockReset(); delete (globalThis as Record<symbol, unknown>)[CTX]; });

const CTX = Symbol.for('__cloudflare-context__');
const FROM = 'Brickfolio <noreply@example.com>';
const MSG = { to: 'ann@example.com', subject: 'Hello', text: 'plain https://app/reset?token=SECRET', html: '<p>hi</p>' };
// Made up at run time, so no key-shaped literal sits in the repo for secret scanners to flag.
const fake = (p: string) => `${p}-${crypto.randomUUID()}`;
const ENVS = {
  resend: { EMAIL_PROVIDER: 'resend', EMAIL_FROM: FROM, RESEND_API_KEY: fake('resend') },
  postmark: { EMAIL_PROVIDER: 'postmark', EMAIL_FROM: FROM, POSTMARK_SERVER_TOKEN: fake('pm') },
  ses: { EMAIL_PROVIDER: 'ses', EMAIL_FROM: FROM, AWS_SES_REGION: 'eu-west-1', AWS_ACCESS_KEY_ID: fake('ses_id'), AWS_SECRET_ACCESS_KEY: fake('ses_secret') },
  cloudflare: { EMAIL_PROVIDER: 'cloudflare', EMAIL_FROM: FROM, CLOUDFLARE_ACCOUNT_ID: 'acc1', CLOUDFLARE_EMAIL_API_TOKEN: fake('cf') },
  smtp: { EMAIL_PROVIDER: 'smtp', EMAIL_FROM: FROM, SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASSWORD: fake('smtp') },
};

describe('emailConfigured', () => {
  it('is false without a provider, an unknown one, or EMAIL_FROM', () => {
    expect(emailConfigured({})).toBe(false);
    expect(emailStatus({ EMAIL_PROVIDER: 'carrier-pigeon', EMAIL_FROM: FROM }).missing[0]).toMatch(/must be one of smtp, resend, ses, postmark, cloudflare/);
    expect(emailStatus({ ...ENVS.resend, EMAIL_FROM: '' }).missing).toEqual(['EMAIL_FROM']);
  });

  it.each(Object.entries({
    resend: ['RESEND_API_KEY'],
    postmark: ['POSTMARK_SERVER_TOKEN'],
    ses: ['AWS_SES_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    cloudflare: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_EMAIL_API_TOKEN'],
    smtp: ['SMTP_HOST'],
  }))('%s needs %j', (name, keys) => {
    const env = ENVS[name as keyof typeof ENVS] as Record<string, string>;
    expect(emailConfigured(env)).toBe(true);
    for (const k of keys) expect(emailStatus({ ...env, [k]: undefined }).missing).toContain(k);
  });

  it('takes AWS_REGION for SES and is case-insensitive about the provider', () => {
    expect(emailConfigured({ ...ENVS.ses, AWS_SES_REGION: undefined, AWS_REGION: 'us-east-1' })).toBe(true);
    expect(emailConfigured({ ...ENVS.resend, EMAIL_PROVIDER: ' Resend ' })).toBe(true);
  });

  it('refuses SMTP on Workers', () => {
    expect(emailConfigured({ ...ENVS.smtp, DB_DRIVER: 'd1' })).toBe(false);
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    expect(emailStatus(ENVS.smtp).missing).toEqual(["SMTP doesn't run on Cloudflare Workers; use resend, ses, postmark or cloudflare"]);
  });

  it('cloudflare on Workers needs only the binding', () => {
    const env = { EMAIL_PROVIDER: 'cloudflare', EMAIL_FROM: FROM, DB_DRIVER: 'd1' };
    (globalThis as Record<symbol, unknown>)[CTX] = { env: {} };
    expect(emailStatus(env).missing).toEqual(['a send_email binding named EMAIL']);
    (globalThis as Record<symbol, unknown>)[CTX] = { env: { MAIL: { send: vi.fn() } } };
    expect(emailConfigured({ ...env, EMAIL_BINDING: 'MAIL' })).toBe(true);
    expect(emailConfigured({ EMAIL_PROVIDER: 'cloudflare', EMAIL_FROM: FROM })).toBe(false); // on Node: needs the REST keys
  });
});

describe('request shapes', () => {
  it('resend', async () => {
    await sendEmail(MSG, ENVS.resend);
    const [c] = calls;
    expect(c.url).toBe('https://api.resend.com/emails');
    expect(c.method).toBe('POST');
    expect(c.headers.get('authorization')).toBe(`Bearer ${ENVS.resend.RESEND_API_KEY}`);
    expect(JSON.parse(c.body)).toEqual({ from: FROM, to: ['ann@example.com'], subject: 'Hello', text: MSG.text, html: MSG.html });
  });

  it('postmark', async () => {
    reply = () => Response.json({ ErrorCode: 0, Message: 'OK' });
    await sendEmail(MSG, ENVS.postmark);
    const [c] = calls;
    expect(c.url).toBe('https://api.postmarkapp.com/email');
    expect(c.headers.get('x-postmark-server-token')).toBe(ENVS.postmark.POSTMARK_SERVER_TOKEN);
    expect(c.headers.get('accept')).toBe('application/json');
    expect(JSON.parse(c.body)).toEqual({ From: FROM, To: 'ann@example.com', Subject: 'Hello', TextBody: MSG.text, HtmlBody: MSG.html, MessageStream: 'outbound' });
  });

  it('ses (SigV4-signed)', async () => {
    reply = () => Response.json({ MessageId: 'm1' });
    await sendEmail(MSG, ENVS.ses);
    const [c] = calls;
    expect(c.url).toBe('https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails');
    expect(c.headers.get('authorization')).toMatch(new RegExp(`^AWS4-HMAC-SHA256 Credential=${ENVS.ses.AWS_ACCESS_KEY_ID}/\\d{8}/eu-west-1/ses/aws4_request, SignedHeaders=\\S+, Signature=[0-9a-f]{64}$`));
    expect(c.headers.get('x-amz-date')).toMatch(/^\d{8}T\d{6}Z$/);
    expect(JSON.parse(c.body)).toEqual({
      FromEmailAddress: FROM,
      Destination: { ToAddresses: ['ann@example.com'] },
      Content: { Simple: { Subject: { Data: 'Hello', Charset: 'UTF-8' }, Body: { Text: { Data: MSG.text, Charset: 'UTF-8' }, Html: { Data: MSG.html, Charset: 'UTF-8' } } } },
    });
  });

  it('cloudflare REST API', async () => {
    reply = () => Response.json({ success: true, errors: [], messages: [], result: { delivered: ['ann@example.com'], permanent_bounces: [], queued: [] } });
    await sendEmail(MSG, ENVS.cloudflare);
    const [c] = calls;
    expect(c.url).toBe('https://api.cloudflare.com/client/v4/accounts/acc1/email/sending/send');
    expect(c.headers.get('authorization')).toBe(`Bearer ${ENVS.cloudflare.CLOUDFLARE_EMAIL_API_TOKEN}`);
    expect(JSON.parse(c.body)).toEqual({ from: { address: 'noreply@example.com', name: 'Brickfolio' }, to: 'ann@example.com', subject: 'Hello', text: MSG.text, html: MSG.html });
  });

  it('cloudflare binding', async () => {
    const send = vi.fn(async () => ({ messageId: 'm' }));
    (globalThis as Record<symbol, unknown>)[CTX] = { env: { EMAIL: { send } }, ctx: {}, cf: {} };
    await sendEmail(MSG, { EMAIL_PROVIDER: 'cloudflare', EMAIL_FROM: FROM, DB_DRIVER: 'd1' });
    expect(send).toHaveBeenCalledWith({ from: { email: 'noreply@example.com', name: 'Brickfolio' }, to: 'ann@example.com', subject: 'Hello', text: MSG.text, html: MSG.html });
    expect(calls).toEqual([]);
  });

  it('smtp', async () => {
    const { createTransport } = await import('nodemailer');
    await sendEmail(MSG, { ...ENVS.smtp, SMTP_PORT: '465' });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.example.com', port: 465, secure: true, auth: { user: 'u', pass: ENVS.smtp.SMTP_PASSWORD }, connectionTimeout: 10000 }));
    expect(sendMail).toHaveBeenCalledWith({ from: FROM, ...MSG });
  });
});

describe('errors', () => {
  it('carries the provider message, but no keys or links', async () => {
    reply = () => Response.json({ statusCode: 422, name: 'validation_error', message: `Invalid \`to\` field ${ENVS.resend.RESEND_API_KEY} see https://app/reset?token=SECRET` }, { status: 422 });
    const err = await sendEmail(MSG, ENVS.resend).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Email via resend failed: HTTP 422: Invalid `to` field [redacted] see [link]');
  });

  it('postmark ErrorCode, ses error type, cloudflare errors array', async () => {
    reply = () => Response.json({ ErrorCode: 300, Message: 'Invalid email request' }, { status: 422 });
    await expect(sendEmail(MSG, ENVS.postmark)).rejects.toThrow('Email via postmark failed: HTTP 422 (code 300): Invalid email request');
    reply = () => new Response(JSON.stringify({ message: 'Email address is not verified.' }), { status: 400, headers: { 'x-amzn-ErrorType': 'MessageRejected:http://internal' } });
    await expect(sendEmail(MSG, ENVS.ses)).rejects.toThrow('Email via ses failed: HTTP 400 MessageRejected: Email address is not verified.');
    reply = () => Response.json({ success: false, errors: [{ code: 10102, message: 'email.sending.error.authentication.forbidden' }], messages: [], result: null }, { status: 403 });
    await expect(sendEmail(MSG, ENVS.cloudflare)).rejects.toThrow('Email via cloudflare failed: HTTP 403: email.sending.error.authentication.forbidden');
    reply = () => Response.json({ success: true, errors: [], result: { delivered: [], permanent_bounces: ['ann@example.com'], queued: [] } });
    await expect(sendEmail(MSG, ENVS.cloudflare)).rejects.toThrow('bounced permanently');
  });

  it('cloudflare binding errors keep their code; a missing binding says how to fix it', async () => {
    const env = { EMAIL_PROVIDER: 'cloudflare', EMAIL_FROM: FROM, DB_DRIVER: 'd1' };
    const send = vi.fn(async () => { throw Object.assign(new Error('Plan only allows verified destinations'), { code: 'E_RECIPIENT_PLAN_RESTRICTED' }); });
    (globalThis as Record<symbol, unknown>)[CTX] = { env: { EMAIL: { send } } };
    await expect(sendEmail(MSG, env)).rejects.toThrow('Email via cloudflare failed: E_RECIPIENT_PLAN_RESTRICTED: Plan only allows verified destinations');
    (globalThis as Record<symbol, unknown>)[CTX] = { env: {} };
    await expect(sendEmail(MSG, { ...env, EMAIL_BINDING: 'X' })).rejects.toThrow(/not set up \(a send_email binding named X\)/);
  });

  it('times out and reports network failures', async () => {
    vi.stubGlobal('fetch', async () => { throw Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }); });
    await expect(sendEmail(MSG, ENVS.resend)).rejects.toThrow('Email via resend failed: no answer within 10 s');
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed'); });
    await expect(sendEmail(MSG, ENVS.postmark)).rejects.toThrow("Email via postmark failed: couldn't connect (fetch failed)");
  });

  it('smtp: refused on Workers before loading nodemailer; its errors drop the password', async () => {
    await expect(sendEmail(MSG, { ...ENVS.smtp, DB_DRIVER: 'd1' })).rejects.toThrow("SMTP doesn't run on Cloudflare Workers; use resend, ses, postmark or cloudflare");
    expect(sendMail).not.toHaveBeenCalled();
    sendMail.mockRejectedValueOnce(new Error(`Invalid login: 535 ${ENVS.smtp.SMTP_PASSWORD} rejected`));
    await expect(sendEmail(MSG, ENVS.smtp)).rejects.toThrow('Email via smtp failed: Invalid login: 535 [redacted] rejected');
  });

  it('refuses when not set up, or for a bad recipient', async () => {
    await expect(sendEmail(MSG, {})).rejects.toThrow('Email via email failed: not set up (EMAIL_PROVIDER)');
    await expect(sendEmail({ ...MSG, to: 'a@b.c, evil@x.y' }, ENVS.resend)).rejects.toThrow('not a valid email address');
    expect(calls).toEqual([]);
  });
});

describe('auth emails', () => {
  it('sends subject, text and HTML with the link', async () => {
    await sendAuthEmail('reset-password', { to: 'ann@example.com', url: 'https://bf.example/reset?token=abc&x=1', name: 'Ann' }, ENVS.resend);
    const body = JSON.parse(calls[0].body);
    expect(body.subject).toBe('Reset your Brickfolio password');
    expect(body.text).toContain('Hi Ann,');
    expect(body.text).toContain('https://bf.example/reset?token=abc&x=1');
    expect(body.html).toContain('href="https://bf.example/reset?token=abc&amp;x=1"');
  });

  it('builds each kind and escapes names in HTML', () => {
    for (const kind of ['reset-password', 'verify-email', 'invitation', 'magic-link'] as const) {
      const m = authEmail(kind, { to: 'a@x', url: 'https://u', name: '<b>Bo</b>', inviter: 'Ann & Co', collection: 'Kids' });
      expect(m.subject).toBeTruthy();
      expect(m.text).toContain('https://u');
      expect(m.html).not.toContain('<b>Bo</b>');
    }
    expect(authEmail('invitation', { to: 'a@x', url: 'https://u', inviter: 'Ann', collection: 'Kids' }).subject).toBe('Ann invited you to Kids');
    expect(authEmail('invitation', { to: 'a@x', url: 'https://u', inviter: 'Ann & Co' }).html).toContain('Ann &amp; Co invited you');
  });

  it('parses sender addresses', () => {
    expect(parseAddress('Brickfolio <noreply@example.com>')).toEqual({ email: 'noreply@example.com', name: 'Brickfolio' });
    expect(parseAddress('"Brick Folio" <a@b.c>')).toEqual({ email: 'a@b.c', name: 'Brick Folio' });
    expect(parseAddress('a@b.c')).toEqual({ email: 'a@b.c' });
  });
});
