import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { catalogFiles, identifiers, rbColors, rbInventories, rbInventoryParts, rbParts, rbSets, sets, themes, wishlist } from '../db/schema';
import { remember, resolve } from '../identifiers/resolve';
import { catalogMode, catalogStatus, filesFor, syncRbCatalog, type CatalogFile } from './rbcatalog';

const gz = (text: string) => new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));

const FILES: Record<CatalogFile, string> = {
  themes: 'id,name,parent_id\n1,Technic,\n171,Ultimate Collector Series,158\n158,Star Wars,\n',
  colors: 'id,name,rgb,is_trans,num_parts,num_sets,y1,y2\n0,Black,05131D,False,1,1,1957,2027\n47,Trans-Clear,FCFCFC,True,1,1,1957,2027\n',
  sets: 'set_num,name,year,theme_id,num_parts,img_url\n75192-1,"Millennium Falcon, UCS",2017,171,7541,https://x/75192.jpg\n42083-1,Bugatti Chiron,2018,1,3599,\n10316-1,Rivendell,2023,171,6181,\n',
  parts: 'part_num,name,part_cat_id,part_material\n3001,Brick 2 x 4,11,Plastic\n3004,Brick 1 x 2,11,Plastic\n',
  inventories: 'id,version,set_num\n1,1,75192-1\n2,1,42083-1\n',
  inventory_parts: 'inventory_id,part_num,color_id,quantity,is_spare,img_url\n1,3001,0,4,False,\n1,3004,47,2,True,\n2,3001,0,10,False,\n',
  elements: 'element_id,part_num,color_id,design_id\n300126,3001,0,3001\n300426,3004,0,3004\n4211388,3001,47,\n',
};

type Served = { files: Partial<Record<CatalogFile, string>>; etags: Partial<Record<CatalogFile, string>>; calls: { name: string; headers: Record<string, string> }[]; fail?: CatalogFile };

function server(files: Partial<Record<CatalogFile, string>> = FILES): Served & { fetch: typeof fetch } {
  const s: Served = { files: { ...files }, etags: {}, calls: [] };
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const name = String(input).split('/').pop()!.replace('.csv.gz', '') as CatalogFile;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    s.calls.push({ name, headers });
    if (s.fail === name) return new Response('nope', { status: 503, statusText: 'Service Unavailable' });
    const body = s.files[name];
    if (body === undefined) return new Response('missing', { status: 404 });
    const etag = s.etags[name] ?? `"${name}-1"`;
    if (headers['If-None-Match'] === etag) return new Response(null, { status: 304 });
    return new Response(gz(body), { headers: { etag, 'last-modified': 'Thu, 19 Nov 2026 07:12:00 GMT' } });
  }) as typeof fetch;
  return Object.assign(s, { fetch: f });
}

let db: DB;
beforeEach(() => { db = openNodeDb(':memory:').db; });
const count = async (table: typeof rbSets | typeof rbParts | typeof rbColors | typeof rbInventories | typeof rbInventoryParts | typeof themes) =>
  Number((await db.select({ n: sql<number>`count(*)` }).from(table).all())[0].n);
const DAY = 86_400_000;
const t0 = new Date('2026-11-19T04:00:00Z');

it('picks the mode from REBRICKABLE_CATALOG and the database driver', () => {
  expect(catalogMode({})).toEqual({ mode: 'full', clamped: false });
  expect(catalogMode({ DB_DRIVER: 'd1' })).toEqual({ mode: 'owned', clamped: false });
  expect(catalogMode({ DB_DRIVER: 'd1', REBRICKABLE_CATALOG: 'full' })).toEqual({ mode: 'owned', clamped: true });
  expect(catalogMode({ REBRICKABLE_CATALOG: 'off' }).mode).toBe('off');
  expect(filesFor('owned')).toEqual(['themes', 'colors', 'sets']);
  expect(filesFor('off')).toEqual([]);
});

describe('full mode', () => {
  it('imports all seven files, then a second run the next day gets 304s and writes nothing', async () => {
    const s = server();
    await remember(db, [
      { kind: 'part', scheme: 'rebrickable', value: '3001', canonical: '3001', source: 'rebrickable' },
      { kind: 'part', scheme: 'rebrickable', value: '3004', canonical: '3004', source: 'rebrickable' },
      { kind: 'color', scheme: 'rebrickable', value: 0, canonical: 11, source: 'rebrickable' },
      { kind: 'color', scheme: 'rebrickable', value: 47, canonical: 12, source: 'rebrickable' },
    ]);
    expect(await syncRbCatalog(db, { mode: 'full', fetchImpl: s.fetch, now: t0 })).toEqual([]);
    expect(s.calls.map((c) => c.name)).toEqual(['themes', 'colors', 'sets', 'parts', 'inventories', 'inventory_parts', 'elements']);
    expect(await count(rbSets)).toBe(3);
    expect(await db.select().from(rbSets).where(eq(rbSets.setNum, '75192-1')).get()).toMatchObject({ name: 'Millennium Falcon, UCS', themeId: 171, numParts: 7541 });
    expect(await count(themes)).toBe(3);
    expect((await db.select().from(themes).where(eq(themes.id, 171)).get())?.parentId).toBe(158);
    expect(await db.select().from(rbColors).where(eq(rbColors.id, 47)).get()).toMatchObject({ isTrans: true, rgb: 'FCFCFC' });
    expect(await count(rbParts)).toBe(2);
    expect(await count(rbInventoryParts)).toBe(3);
    expect((await resolve(db, 'element', 'lego_element', '300126')).canonical).toBe('3001:11');
    expect((await resolve(db, 'element', 'lego_element', '4211388')).canonical).toBe('3001:12');

    const files = await db.select().from(catalogFiles).all();
    expect(files).toHaveLength(7);
    expect(files.find((f) => f.name === 'sets')).toMatchObject({ rows: 3, written: 3, etag: '"sets-1"', error: null });

    // The same day: nothing is downloaded at all.
    s.calls.length = 0;
    await syncRbCatalog(db, { mode: 'full', fetchImpl: s.fetch, now: new Date(t0.getTime() + 3_600_000) });
    expect(s.calls).toHaveLength(0);

    // The next day: conditional requests, all 304, nothing written.
    await syncRbCatalog(db, { mode: 'full', fetchImpl: s.fetch, now: new Date(t0.getTime() + DAY) });
    expect(s.calls).toHaveLength(7);
    expect(s.calls.every((c) => c.headers['If-None-Match'])).toBe(true);
    expect((await db.select().from(catalogFiles).where(eq(catalogFiles.name, 'sets')).get())?.importedAt).toBe(t0.toISOString());
  });

  it('writes only what changed, and removes what the file no longer has', async () => {
    const s = server();
    await syncRbCatalog(db, { mode: 'full', fetchImpl: s.fetch, now: t0 });
    s.files.sets = 'set_num,name,year,theme_id,num_parts,img_url\n75192-1,"Millennium Falcon, UCS",2017,171,7542,https://x/75192.jpg\n10316-1,Rivendell,2023,171,6181,\n';
    s.files.inventory_parts = 'inventory_id,part_num,color_id,quantity,is_spare,img_url\n2,3001,0,12,False,\n';
    s.files.inventories = 'id,version,set_num\n2,1,42083-1\n';
    for (const k of ['sets', 'inventory_parts', 'inventories'] as const) s.etags[k] = `"${k}-2"`;
    await syncRbCatalog(db, { mode: 'full', fetchImpl: s.fetch, now: new Date(t0.getTime() + DAY) });
    const f = new Map((await db.select().from(catalogFiles).all()).map((r) => [r.name, r]));
    expect(f.get('sets')).toMatchObject({ rows: 2, written: 2 }); // one changed, one removed
    expect(await db.select().from(rbSets).where(eq(rbSets.setNum, '42083-1')).get()).toBeUndefined();
    expect((await db.select().from(rbSets).where(eq(rbSets.setNum, '75192-1')).get())?.numParts).toBe(7542);
    // Inventory 1 was dropped (its parts with it); inventory 2's parts changed and were rewritten.
    expect(await db.select().from(rbInventoryParts).all()).toEqual([{ inventoryId: 2, partNum: '3001', colorId: 0, quantity: 12, isSpare: false }]);
  });

  it('refuses a file whose columns changed, and keeps the previous rows', async () => {
    const s = server();
    await syncRbCatalog(db, { mode: 'full', fetchImpl: s.fetch, now: t0 });
    s.files.sets = 'set_num,name,year,theme_id,num_parts\n99999-1,New,2026,1,10\n';
    s.etags.sets = '"sets-2"';
    const errors = await syncRbCatalog(db, { mode: 'full', fetchImpl: s.fetch, now: new Date(t0.getTime() + DAY) });
    expect(errors).toEqual(['Rebrickable catalog sets.csv: expected the columns set_num,name,year,theme_id,num_parts,img_url, got set_num,name,year,theme_id,num_parts; nothing was changed']);
    expect(await count(rbSets)).toBe(3);
    const row = await db.select().from(catalogFiles).where(eq(catalogFiles.name, 'sets')).get();
    expect(row).toMatchObject({ etag: '"sets-1"', error: expect.stringContaining('expected the columns') });
    // A failed file is tried again on the next run, even the same day.
    s.files.sets = FILES.sets;
    s.calls.length = 0;
    await syncRbCatalog(db, { mode: 'full', fetchImpl: s.fetch, now: new Date(t0.getTime() + DAY + 60_000) });
    expect(s.calls.map((c) => c.name)).toEqual(['sets']);
    expect((await db.select().from(catalogFiles).where(eq(catalogFiles.name, 'sets')).get())?.error).toBeNull();
  });

  it('keeps the old rows when a download fails, and carries on with the other files', async () => {
    const s = server();
    await syncRbCatalog(db, { mode: 'full', fetchImpl: s.fetch, now: t0 });
    s.fail = 'parts';
    const errors = await syncRbCatalog(db, { mode: 'full', fetchImpl: s.fetch, now: new Date(t0.getTime() + DAY), force: true });
    expect(errors).toEqual(['Rebrickable catalog parts.csv: download answered 503 Service Unavailable']);
    expect(await count(rbParts)).toBe(2);
    expect(s.calls.filter((c) => c.name === 'elements')).toHaveLength(2);
  });

  it('refuses an inventory_parts file that is not grouped by inventory', async () => {
    const s = server({ inventory_parts: 'inventory_id,part_num,color_id,quantity,is_spare,img_url\n1,3001,0,4,False,\n2,3001,0,1,False,\n1,3004,0,1,False,\n' });
    const errors = await syncRbCatalog(db, { mode: 'full', fetchImpl: s.fetch, now: t0 });
    expect(errors).toContain("Rebrickable catalog inventory_parts.csv: inventory_parts.csv isn't grouped by inventory_id (inventory 1 appears twice)");
  });

  it('maps elements through the identifiers map, counts the ones it cannot, and retries them', async () => {
    const s = server({ elements: FILES.elements });
    await remember(db, [
      { kind: 'part', scheme: 'rebrickable', value: '3001', canonical: '3001', source: 'rebrickable' },
      { kind: 'color', scheme: 'rebrickable', value: 0, canonical: 11, source: 'rebrickable' },
    ]);
    await syncRbCatalog(db, { mode: 'full', fetchImpl: s.fetch, now: t0 });
    expect(await db.select().from(catalogFiles).where(eq(catalogFiles.name, 'elements')).get()).toMatchObject({ rows: 3, written: 1, skipped: 2 });
    expect((await resolve(db, 'element', 'lego_element', '300426')).canonical).toBeNull();

    // The part map fills in; the next day's run downloads elements again without a conditional header.
    await remember(db, [
      { kind: 'part', scheme: 'rebrickable', value: '3004', canonical: '3004', source: 'rebrickable' },
      { kind: 'color', scheme: 'rebrickable', value: 47, canonical: 12, source: 'rebrickable' },
    ]);
    s.calls.length = 0;
    await syncRbCatalog(db, { mode: 'full', fetchImpl: s.fetch, now: new Date(t0.getTime() + DAY) });
    expect(s.calls.find((c) => c.name === 'elements')?.headers['If-None-Match']).toBeUndefined();
    expect(await db.select().from(catalogFiles).where(eq(catalogFiles.name, 'elements')).get()).toMatchObject({ written: 2, skipped: 0 });
    expect((await resolve(db, 'element', 'lego_element', '300426')).canonical).toBe('3004:11');
    const rows = await db.select().from(identifiers).where(eq(identifiers.kind, 'element')).all();
    expect(rows).toHaveLength(3);

    // Rebrickable moves an element to another colour: the old row goes, so it doesn't look ambiguous.
    s.files.elements = 'element_id,part_num,color_id,design_id\n300126,3001,47,3001\n';
    s.etags.elements = '"elements-2"';
    await syncRbCatalog(db, { mode: 'full', fetchImpl: s.fetch, now: new Date(t0.getTime() + 2 * DAY) });
    expect((await resolve(db, 'element', 'lego_element', '300126')).canonical).toBe('3001:12');
  });
});

describe('owned mode', () => {
  it('imports themes, colours and only your own sets, and never downloads the big files', async () => {
    await db.insert(sets).values({ setNo: '75192', name: 'Millennium Falcon' }).run();
    await db.insert(wishlist).values({ setNo: '10316-1', name: 'Rivendell' }).run();
    const s = server();
    expect(await syncRbCatalog(db, { mode: 'owned', fetchImpl: s.fetch, now: t0 })).toEqual([]);
    expect(s.calls.map((c) => c.name)).toEqual(['themes', 'colors', 'sets']);
    expect((await db.select({ n: rbSets.setNum }).from(rbSets).all()).map((r) => r.n).sort()).toEqual(['10316-1', '75192-1']);
    expect(await count(themes)).toBe(3);
    const status = await catalogStatus(db, { DB_DRIVER: 'd1' });
    expect(status.mode).toBe('owned');
    expect(status.files.map((f) => [f.name, f.rows])).toEqual([['themes', 3], ['colors', 2], ['sets', 3]]);

    // A set added later is picked up the next day: sets.csv is fetched again in this mode.
    await db.insert(sets).values({ setNo: '42083', name: 'Bugatti Chiron' }).run();
    await syncRbCatalog(db, { mode: 'owned', fetchImpl: s.fetch, now: new Date(t0.getTime() + DAY) });
    expect(await count(rbSets)).toBe(3);
  });

  it('does nothing when off', async () => {
    const s = server();
    expect(await syncRbCatalog(db, { mode: 'off', fetchImpl: s.fetch })).toEqual([]);
    expect(s.calls).toHaveLength(0);
  });
});

it('works through the statement-by-statement path D1 uses', async () => {
  // Without better-sqlite3's client, statements run one by one, as on D1.
  const d1Like = new Proxy(db, { get: (t, k) => (k === '$client' ? undefined : Reflect.get(t, k, t)) }) as DB;
  const s = server();
  await d1Like.insert(sets).values({ setNo: '42083-1', name: 'Bugatti Chiron' }).run();
  expect(await syncRbCatalog(d1Like, { mode: 'owned', fetchImpl: s.fetch, now: t0 })).toEqual([]);
  expect((await db.select().from(rbSets).all()).map((r) => r.setNum)).toEqual(['42083-1']);
  expect((await db.select().from(catalogFiles).where(eq(catalogFiles.name, 'themes')).get())?.written).toBe(3);
  await syncRbCatalog(d1Like, { mode: 'owned', fetchImpl: s.fetch, now: new Date(t0.getTime() + DAY) });
  expect((await db.select().from(catalogFiles).where(eq(catalogFiles.name, 'sets')).get())).toMatchObject({ rows: 3, written: 0 });
});
