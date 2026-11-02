// OAuth 1.0a request signing (HMAC-SHA1), as the BrickLink API requires. Web Crypto only, so it runs on
// Node and on Cloudflare Workers.

export type OAuthKeys = { consumerKey: string; consumerSecret: string; token: string; tokenSecret: string };

/** RFC 3986 percent-encoding, which OAuth requires (encodeURIComponent leaves !'()* alone). */
export const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export async function hmacSha1Base64(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
  return btoa(String.fromCharCode(...sig));
}

/**
 * Signs a request. `params` are the query (or form body) parameters, which are part of the signature.
 * `nonce`/`timestamp` are only passed by tests.
 */
export async function oauthHeader(
  method: string,
  url: string,
  params: Record<string, string>,
  keys: OAuthKeys,
  nonce = crypto.randomUUID().replace(/-/g, ''),
  timestamp = String(Math.floor(Date.now() / 1000)),
): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: keys.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: keys.token,
    oauth_version: '1.0',
  };
  const all = Object.entries({ ...params, ...oauth })
    .map(([k, v]) => [pct(k), pct(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const base = [method.toUpperCase(), pct(url), pct(all)].join('&');
  oauth.oauth_signature = await hmacSha1Base64(`${pct(keys.consumerSecret)}&${pct(keys.tokenSecret)}`, base);
  return 'OAuth ' + Object.entries(oauth).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(', ');
}
