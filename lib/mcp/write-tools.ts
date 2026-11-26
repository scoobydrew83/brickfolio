// MCP tools that change the collection, for assistants you trust (Claude adding a set you just bought, marking one
// sold). Off unless MCP_WRITE=on. They check permissions exactly as the app and the REST API do (#50): adding needs a
// collection you can add to, a copy can only be changed in a collection you can write, and the wishlist needs the
// `shared` role. Demo mode refuses them.
import type { DB } from '../db/types';
import { isDemo, DEMO_ERROR } from '../demo';
import { parseCopyInput, parseSetWithCopy, placeholderName, setNo as fullSetNo, displayNo } from '../sets';
import { addCopy, editCopy, removeCopy } from '../service/copies';
import { listCollections, collectionExists } from '../service/collections';
import { addSet, getSet, listLocations } from '../service/sets';
import { addWish, parseWishInput, removeWish } from '../service/wishlist';
import { can, copyCollection, denied, readable, type Access } from '../service/permissions';
import type { Lookup } from '../bricklink/client';

type Json = Record<string, unknown>;
export type WriteTool = { name: string; title: string; description: string; inputSchema: Json; destructive?: boolean; run: (db: DB, args: Json, access: Access) => Promise<unknown> };

/** MCP_WRITE=on turns the write tools on. */
export const mcpWriteOn = (env: Record<string, string | undefined> = process.env) => env.MCP_WRITE === 'on';

/** BrickLink lookups for new sets, when the server has keys (never in tests). */
async function lookup(): Promise<Lookup | null> {
  try { return (await import('../session')).bricklink(); } catch { return null; }
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const need = (access: Access, n: Parameters<typeof can>[1]) => { if (!can(access, n)) throw new Error(denied(n)); };
const result = <T>(r: { ok: true } & T | { ok: false; error: string }): T => { if (!r.ok) throw new Error(r.error); return r; };

/** Where a new set or copy goes: the named collection when you can add to it, else the first one you can. */
async function target(db: DB, access: Access, given: unknown): Promise<number> {
  const all = await listCollections(db);
  const v = str(given, 40);
  if (v) {
    const hit = all.find((c) => String(c.id) === v) ?? all.find((c) => c.name.toLowerCase() === v.toLowerCase());
    if (!hit || !(await collectionExists(db, hit.id))) throw new Error(`No collection called ${v}.`);
    need(access, { action: 'write', collectionId: hit.id });
    return hit.id;
  }
  const first = all.find((c) => can(access, { action: 'write', collectionId: c.id }));
  if (!first) throw new Error("You don't have permission to add to any collection.");
  return first.id;
}

/** A copy you may change; one you can't see is "not found". */
async function copyGuard(db: DB, access: Access, copyId: number) {
  const col = await copyCollection(db, copyId);
  if (col === null || !can(access, { action: 'read', collectionId: col })) throw new Error(`Copy ${copyId} doesn't exist.`);
  need(access, { action: 'write', collectionId: col });
}

const copyProps = {
  status: { enum: ['sealed', 'built', 'in_progress', 'parted_out', 'sold'], description: 'sealed means New; sold leaves the count and value' },
  condition: { enum: ['New', 'Used', 'Partial'] },
  location: { type: 'string', description: 'An existing location (Settings → Locations)' },
  missingPct: { type: 'number', minimum: 0, maximum: 100 },
  acquiredDate: { type: 'string', description: 'YYYY-MM-DD' },
  buildDate: { type: 'string', description: 'YYYY-MM-DD' },
  pricePaid: { type: 'number', minimum: 0, description: 'In the collection currency, unless paidCurrency is given' },
  paidCurrency: { type: 'string', description: 'ISO code (EUR, GBP…) when pricePaid is in another currency; converted at the ECB rate for acquiredDate' },
  tax: { type: 'number', minimum: 0 }, shipping: { type: 'number', minimum: 0 }, gwp: { type: 'boolean', description: 'Gift with purchase (cost 0)' },
  soldDate: { type: 'string', description: 'YYYY-MM-DD (today when status is sold and this is left out)' },
  salePrice: { type: 'number', minimum: 0 }, saleFees: { type: 'number', minimum: 0 }, soldVia: { type: 'string' },
  hasBox: { type: 'boolean' }, hasInstructions: { type: 'boolean' }, stickers: { enum: ['applied', 'unapplied', 'none'] }, boughtFrom: { type: 'string' },
  notes: { type: 'string' },
};
const collectionProp = { collection: { type: 'string', description: 'Collection name or id to add to (see list_collections). Your first writable one when left out.' } };
const pick = (a: Json, keys: string[]) => Object.fromEntries(keys.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
const copySummary = (c: { id: number; status: string; condition: string; location: string | null }) => ({ id: c.id, status: c.status, condition: c.condition, location: c.location });

const TOOLS: WriteTool[] = [
  {
    name: 'add_set',
    title: 'Add a set',
    description: 'Adds a set to the collection with one or more copies (qty). The name is optional: BrickLink fills it in. A set already in the collection is refused (use add_copy). The set is looked up on BrickLink now when the server has keys, else at the next sync.',
    inputSchema: { type: 'object', properties: { setNo: { type: 'string', description: 'e.g. 10497 or 10497-1' }, name: { type: 'string', description: 'Optional; BrickLink fills it in' }, qty: { type: 'integer', minimum: 1, maximum: 99 }, ...copyProps, ...collectionProp }, required: ['setNo'] },
    async run(db, a, access) {
      need(access, 'member');
      const to = await target(db, access, a.collection);
      const form: Json = { ...pick(a, ['setNo', 'name', 'qty', 'condition', 'location', 'missingPct', 'notes']), ...pick(a, ['status', 'acquiredDate', 'buildDate', 'pricePaid', 'paidCurrency', 'tax', 'shipping', 'gwp', 'hasBox', 'hasInstructions', 'stickers', 'boughtFrom']), copyNotes: a.copyNotes };
      // Without a name, the same placeholder Paste a list uses; the BrickLink lookup replaces it.
      if (!str(form.name as string)) form.name = placeholderName(fullSetNo(str(a.setNo, 12)));
      form.condition ??= form.status === 'sealed' ? 'New' : 'Used'; // the app's form always sends one
      const p = parseSetWithCopy(form, false, await listLocations(db));
      if (!p.ok) throw new Error(p.error);
      const r = result(await addSet(db, { ...p.value, copy: { ...p.value.copy, collectionId: to } }, { lookup: await lookup(), seen: readable(access) }));
      return { added: displayNo(r.set.setNo), name: r.set.name, qty: r.set.qty, copies: r.set.copies.map(copySummary) };
    },
  },
  {
    name: 'add_copy',
    title: 'Add a copy of a set',
    description: 'Adds one copy to a set already in the collection, with its own status, condition, location, cost and details.',
    inputSchema: { type: 'object', properties: { setNo: { type: 'string' }, ...copyProps, ...collectionProp }, required: ['setNo'] },
    async run(db, a, access) {
      need(access, 'member');
      const no = fullSetNo(str(a.setNo, 12));
      if (!(await getSet(db, no, { collectionId: readable(access) }))) throw new Error(`Set ${displayNo(no)} isn't in the collection. Use add_set.`);
      const to = await target(db, access, a.collection);
      const p = parseCopyInput(pick(a, Object.keys(copyProps)), false, await listLocations(db));
      if (!p.ok) throw new Error(p.error);
      const r = result(await addCopy(db, no, { ...p.value, collectionId: to }, await lookup()));
      return { setNo: displayNo(no), copyId: r.copyId, qty: r.set.qty };
    },
  },
  {
    name: 'edit_copy',
    title: 'Change a copy',
    description: 'Changes one copy (ids are in get_set → copyList): status, condition, location, dates, cost, details, or marking it sold with salePrice, saleFees, soldVia and soldDate. Only the fields given change.',
    inputSchema: { type: 'object', properties: { copyId: { type: 'integer' }, ...copyProps }, required: ['copyId'] },
    async run(db, a, access) {
      const id = Number(a.copyId);
      if (!Number.isInteger(id) || id < 1) throw new Error('copyId must be a copy id from get_set.');
      await copyGuard(db, access, id);
      const p = parseCopyInput(pick(a, Object.keys(copyProps)), true, await listLocations(db));
      if (!p.ok) throw new Error(p.error);
      const r = result(await editCopy(db, id, p.value, await lookup()));
      const c = r.set.copies.find((x) => x.id === id);
      return { setNo: displayNo(r.set.setNo), copy: c ? { ...copySummary(c), soldDate: c.soldDate ?? null, salePrice: c.salePrice ?? null } : null, qty: r.set.qty, sold: r.set.sold, realised: r.set.realised };
    },
  },
  {
    name: 'remove_copy',
    title: 'Remove a copy',
    description: 'Deletes one copy for good (a set goes with its last copy). To record a sale instead, use edit_copy with status sold.',
    destructive: true,
    inputSchema: { type: 'object', properties: { copyId: { type: 'integer' } }, required: ['copyId'] },
    async run(db, a, access) {
      const id = Number(a.copyId);
      if (!Number.isInteger(id) || id < 1) throw new Error('copyId must be a copy id from get_set.');
      await copyGuard(db, access, id);
      const r = result(await removeCopy(db, id));
      return { removed: id, setNo: displayNo(r.setNo), remaining: r.remaining };
    },
  },
  {
    name: 'add_wish',
    title: 'Add to the wishlist',
    description: 'Puts a set on the shared wishlist, with an optional target price (alerts fire when its BrickLink average sold price drops under it) and the wanted condition.',
    inputSchema: { type: 'object', properties: { setNo: { type: 'string' }, target: { type: 'number', minimum: 0 }, condition: { enum: ['New', 'Used'] }, notes: { type: 'string' } }, required: ['setNo'] },
    async run(db, a, access) {
      need(access, 'shared');
      const p = parseWishInput(pick(a, ['setNo', 'target', 'condition', 'notes']));
      if (!p.ok) throw new Error(p.error);
      const r = result(await addWish(db, p.value, await lookup()));
      return { added: displayNo(r.wish.setNo), name: r.wish.name, target: r.wish.target, condition: r.wish.condition };
    },
  },
  {
    name: 'remove_wish',
    title: 'Remove from the wishlist',
    description: 'Takes a set off the shared wishlist.',
    destructive: true,
    inputSchema: { type: 'object', properties: { setNo: { type: 'string' } }, required: ['setNo'] },
    async run(db, a, access) {
      need(access, 'shared');
      result(await removeWish(db, str(a.setNo, 12)));
      return { removed: displayNo(fullSetNo(str(a.setNo, 12))) };
    },
  },
];

/** The write tools, each refusing in demo mode. */
export const WRITE_TOOLS: WriteTool[] = TOOLS.map((t) => ({ ...t, run: async (db, a, access) => { if (isDemo()) throw new Error(DEMO_ERROR); return t.run(db, a, access); } }));
