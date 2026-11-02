// Server-only helpers for pages, server actions and route handlers.
import 'server-only';
import { headers } from 'next/headers';
import { identify, bearer, type Identity } from './auth';
import { brickLinkFromEnv } from './bricklink/client';
import { rebrickableFromEnv } from './rebrickable/client';
import { getDb } from './db';
import { checkToken, sha256Hex } from './service/tokens';
import { isDemo } from './demo';

/** The signed-in user for a page or server action, or null. */
export async function currentUser(): Promise<Identity | null> {
  return identify(await headers());
}

/** For REST routes: CRON_SECRET (scheduler), an API token, or the same identity as the browser. */
export async function apiUser(req: Request): Promise<Identity | null> {
  const token = bearer(req.headers);
  if (token) {
    const cron = process.env.CRON_SECRET;
    if (cron && (await sha256Hex(token)) === (await sha256Hex(cron))) return { user: 'cron', via: 'cron' };
    const name = await checkToken(await getDb(), token);
    return name ? { user: `token:${name}`, via: 'token' } : null;
  }
  return identify(req.headers);
}

let client: ReturnType<typeof brickLinkFromEnv> | undefined;
/** BrickLink client from env (null when keys aren't set). One per process, so its call spacing is shared. */
const blClient = () => (isDemo() ? null : client === undefined ? (client = brickLinkFromEnv()) : client);
/** Set lookups, or null when the BrickLink keys aren't set. */
export const bricklink = () => blClient()?.lookup ?? null;
/** Fetches BrickLink color names, or null when the keys aren't set. */
export const brickColors = () => blClient()?.colors ?? null;
/** Your BrickLink store's inventory and orders, or null when the keys aren't set. */
export const brickStore = () => blClient()?.store ?? null;

let rb: ReturnType<typeof rebrickableFromEnv> | undefined;
/** Rebrickable catalog client (themes, minifigs), or null when REBRICKABLE_API_KEY isn't set. One per process. */
export const rebrickable = () => (isDemo() ? null : rb === undefined ? (rb = rebrickableFromEnv()) : rb);
