// Server-only helpers for pages, server actions and route handlers.
import 'server-only';
import { cookies, headers } from 'next/headers';
import { allowed, identify, bearer, type Identity } from './auth';
import { brickLinkFromEnv } from './bricklink/client';
import { rebrickableFromEnv } from './rebrickable/client';
import { bricksetFromEnv } from './brickset/client';
import { barcodeCapabilities, providersFromEnv, type BarcodeLookupProvider } from './barcode/providers';
import { getDb } from './db';
import { checkToken, sha256Hex } from './service/tokens';
import { isDemo } from './demo';
import { resolveAccess, type Access } from './service/permissions';

/** What the signed-in user may see and do (#50), or null when nobody is signed in. */
export async function currentAccess(): Promise<Access | null> {
  const id = await currentUser();
  return id ? resolveAccess(await getDb(), id) : null;
}

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
    const t = await checkToken(await getDb(), token);
    // A token stops working when its owner is no longer allowed in (#50); ones without a login are unaffected.
    if (!t || (t.owner && t.owner !== 'local' && !allowed(t.owner))) return null;
    return { user: `token:${t.name}`, via: 'token', owner: t.owner };
  }
  return identify(req.headers);
}

let client: ReturnType<typeof brickLinkFromEnv> | undefined;
/** BrickLink client from env (null when keys aren't set). One per process, so its call spacing is shared. */
const blClient = () => (isDemo() ? null : client === undefined ? (client = brickLinkFromEnv()) : client);
/** Set lookups, or null when the BrickLink keys aren't set. */
export const bricklink = () => blClient()?.lookup ?? null;
/** Minifigure lookups, or null when the BrickLink keys aren't set. */
export const brickMinifig = () => blClient()?.minifig ?? null;
/** Part sold prices (part-out value), or null when the BrickLink keys aren't set. */
export const brickPartPrice = () => blClient()?.partPrice ?? null;
/** One sold price guide (1 call): the other condition's prices for the new vs. used gap. Null without BrickLink keys. */
export const brickPrice = () => blClient()?.price ?? null;
/** Fetches BrickLink color names, or null when the keys aren't set. */
export const brickColors = () => blClient()?.colors ?? null;
/** Your BrickLink store's inventory and orders, or null when the keys aren't set. */
export const brickStore = () => blClient()?.store ?? null;

let rb: ReturnType<typeof rebrickableFromEnv> | undefined;
/** Rebrickable catalog client (themes, minifigs), or null when REBRICKABLE_API_KEY isn't set. One per process. */
export const rebrickable = () => (isDemo() ? null : rb === undefined ? (rb = rebrickableFromEnv()) : rb);

let bs: ReturnType<typeof bricksetFromEnv> | undefined;
/** Brickset client (retail prices, retirement dates), or null when BRICKSET_API_KEY isn't set. One per process. */
export const brickset = () => (isDemo() ? null : bs === undefined ? (bs = bricksetFromEnv()) : bs);

let bp: BarcodeLookupProvider[] | undefined;
/** Barcode lookup providers with a key, in order (lib/barcode/providers.ts). None in demo mode. One set per process. */
export const barcodeProviders = (): BarcodeLookupProvider[] => (isDemo() ? [] : (bp ??= providersFromEnv()));
/** Which barcode lookups are on, for the scanner and Settings. No secrets. */
export const barcodeCaps = () => (isDemo() ? { ...barcodeCapabilities({}), scanning: true } : barcodeCapabilities());

/** The cookie holding the selected collection (#49): `all` or an id. */
export const COLLECTION_COOKIE = 'bf_collection';

/** The collection this browser has selected (an existing id, or 'all'), before permissions. */
export async function currentSelection(): Promise<number | 'all'> {
  const raw = (await cookies()).get(COLLECTION_COOKIE)?.value;
  const { parseScope, collectionExists } = await import('./service/collections');
  const s = parseScope(raw);
  if (s === null || s === 'all') return 'all';
  return (await collectionExists(await getDb(), s)) ? s : 'all';
}

/**
 * What pages read (#49, #50): the selected collection, or every collection. For someone who isn't an admin, "every"
 * means every collection they have a role in, and a selected collection they can't read counts as "every".
 */
export async function currentCollection(): Promise<number | 'all' | number[]> {
  const [sel, access] = await Promise.all([currentSelection(), currentAccess()]);
  if (!access) return [];
  const { clampScope } = await import('./service/permissions');
  return clampScope(access, sel) ?? clampScope(access, 'all')!;
}

/**
 * Where a new set, copy or minifigure goes: the selected collection when the user can add to it, else (for an admin)
 * the default collection, else the first collection they can add to. Undefined when there's none: the action's
 * permission check refuses it then.
 */
export async function writeCollection(): Promise<number | undefined> {
  const [sel, access] = await Promise.all([currentSelection(), currentAccess()]);
  if (!access) return undefined;
  const { can } = await import('./service/permissions');
  if (sel !== 'all' && can(access, { action: 'write', collectionId: sel })) return sel;
  if (access.admin) return undefined;
  const { listCollections } = await import('./service/collections');
  return (await listCollections(await getDb())).find((c) => can(access, { action: 'write', collectionId: c.id }))?.id;
}

/**
 * Why a page can't be shown to this person, or null when it can (#50): not signed in, no collection yet, or (for
 * `admin` pages) not an admin. Pages render the message instead of their content.
 */
export async function pageBlock(need: 'member' | 'admin'): Promise<string | null> {
  const a = await currentAccess();
  if (!a) return 'Not signed in.';
  const { can } = await import('./service/permissions');
  if (can(a, need)) return null;
  if (need === 'admin' && can(a, 'member')) return 'Only admins can see this page.';
  return "You don't have access to any collection yet. Ask an admin to add you to one.";
}
