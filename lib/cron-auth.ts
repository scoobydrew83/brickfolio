// The CRON_SECRET check for GET /api/v1/sync/cron. Hashes both sides (WebCrypto, so it also runs on Workers) so the
// comparison takes the same time whatever the secret's length or the first differing character.
const hex = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');

/** True when the request carries "Authorization: Bearer <secret>" and a secret is set. */
export async function isCronRequest(headers: Headers, secret: string | undefined): Promise<boolean> {
  const m = /^Bearer\s+(.+)$/i.exec(headers.get('authorization')?.trim() ?? '');
  if (!secret || !m) return false;
  const [a, b] = await Promise.all([hex(m[1].trim()), hex(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
