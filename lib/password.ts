// Password hashing for Better Auth (#90). On Cloudflare Workers, PBKDF2-SHA256 through WebCrypto (100,000 iterations,
// workerd's maximum): Better Auth's default scrypt runs in JavaScript there and can take more CPU time than a request
// gets. Everywhere else, Better Auth's scrypt. `verifyPassword` reads both formats, so a database moved between hosts
// keeps everyone's password working.
//
// PBKDF2 hashes look like `pbkdf2$100000$<salt, base64>$<hash, base64>`; scrypt ones are Better Auth's `<salt>:<key>`.
import { hashPassword as scryptHash, verifyPassword as scryptVerify } from 'better-auth/crypto';

export const PBKDF2_ITERATIONS = 100_000;
const PREFIX = 'pbkdf2$';
const KEY_BITS = 256;

/** Whether this code runs on Cloudflare Workers (workerd sets this user agent). */
export const onWorkers = () => typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, KEY_BITS));
}

/** Compares two byte strings in time that depends only on their lengths. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function pbkdf2Hash(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${PREFIX}${iterations}$${b64(salt)}$${b64(await derive(password, salt, iterations))}`;
}

async function pbkdf2Verify(hash: string, password: string): Promise<boolean> {
  const [, n, salt, key] = hash.split('$');
  const iterations = Number(n);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS || !salt || !key) return false;
  try {
    return constantTimeEqual(await derive(password, unb64(salt), iterations), unb64(key));
  } catch {
    return false; // not base64
  }
}

/** Hashes a new password: PBKDF2 on Workers, scrypt elsewhere. */
export const hashPassword = (password: string) => (onWorkers() ? pbkdf2Hash(password) : scryptHash(password));

/** Checks a password against either format. */
export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  if (hash.startsWith(PREFIX)) return pbkdf2Verify(hash, password);
  try {
    return await scryptVerify({ hash, password }); // Better Auth's own compare is constant-time
  } catch {
    return false;
  }
}
