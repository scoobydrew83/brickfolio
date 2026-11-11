// A Model Context Protocol server for Brickfolio, so Claude and other assistants can answer questions about the
// collection. Streamable HTTP transport, stateless, JSON responses (no server-sent events); every tool is read-only.
// Spec: https://modelcontextprotocol.io/specification. Served at /api/mcp (app/api/mcp/route.ts).
import pkg from '../../package.json';
import { APP_NAME } from '../brand';
import type { DB } from '../db/types';
import { conditionGap, copyGuide, costBasis, dailyHistory, displayNo, filterSets, groupTotals, setGuide, setNo as fullSetNo, STATUSES, totals, type Filters, type SetRow } from '../sets';
import { brickLinkGuides } from '../service/prices';
import { collectionGain, retirement } from '../retail';
import { getCurrency, getSet, listHistory, listSets, priceHistory, syncStatus } from '../service/sets';
import { listWishlist } from '../service/wishlist';
import { getRadar } from '../service/radar';
import { listProjects } from '../service/designer';
import { listMinifigs, minifigTotals } from '../service/minifigs';
import { partout, unpricedLots } from '../service/partout';
import { listMissing, pickCopy } from '../service/missing';
import { searchParts } from '../service/parts';
import { layoutNeeds, listLayouts } from '../service/layouts';
import { listLots } from '../service/lots';
import { sizeLabel } from '../layouts';
import { resolveBarcode } from '../barcode/resolve';
import { resolveFigCode } from '../barcode/figcodes';

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
const VERSION = pkg.version;

type Json = Record<string, unknown>;
type Tool = { name: string; title: string; description: string; inputSchema: Json; run: (db: DB, args: Json) => Promise<unknown> };

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown, def: number, min: number, max: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), min), max) : def; };
const r2 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100) / 100);

/** A set as the tools return it: short, with the source of each number spelled out once in the descriptions. */
const brief = (s: SetRow) => {
  const n = (st: string) => s.copies.filter((c) => c.status === st).length;
  return {
    setNo: displayNo(s.setNo), name: s.name, year: s.year, theme: s.subtheme ? `${s.theme} / ${s.subtheme}` : s.theme ?? null,
    qty: s.qty, copies: { sealed: n('sealed'), built: n('built'), inProgress: n('in_progress'), partedOut: n('parted_out') },
    condition: s.condition, missingPct: s.missingPct, location: s.location, estValueEach: r2(s.estValue),
    estValueTotal: r2(s.valueTotal), costBasis: r2(s.costBasis), gain: r2(s.gain), retail: s.retailPrice ?? null, retailCurrency: s.retailCurrency ?? null,
    retirement: retirement(s), pieces: s.pieces,
  };
};

/** The condition whose guide partout() should price a set in: the guide most of its copies need. */
const guideCondition = (s: SetRow) => (setGuide(s.copies) === 'N' ? 'New' as const : 'Used' as const);

export const TOOLS: Tool[] = [
  {
    name: 'collection_summary',
    title: 'Collection summary',
    description: 'Totals for the whole collection: sets, copies (each physical copy of a set: sealed, built, in progress; parted out copies are not counted), minifigures, estimated value (BrickLink average sold prices, less missing pieces), cost basis and gain where purchase prices are recorded, change over the stored value history, gain over original retail (Brickset), and value by location, condition and theme. Start here.',
    inputSchema: { type: 'object', properties: {} },
    async run(db) {
      const [sets, figs, hist, currency, sync] = await Promise.all([listSets(db), listMinifigs(db), listHistory(db), getCurrency(db), syncStatus(db)]);
      const t = totals(sets), f = minifigTotals(figs), d = dailyHistory(hist);
      const group = (k: 'location' | 'condition' | 'theme') => groupTotals(sets, k).map((g) => ({ [k]: g.label, sets: g.count, copies: g.copies, estValue: r2(g.estValue) }));
      return {
        currency, lastSync: sync?.finishedAt ?? null,
        sets: { count: t.count, copies: t.copies, partedOut: t.partedOut, pieces: t.pieces, estValue: r2(t.estValue), costBasis: r2(t.costBasis), gain: r2(t.gain), notFoundOnBrickLink: t.errors },
        minifigures: { count: f.count, copies: f.copies, estValue: r2(f.estValue), unpriced: f.unpriced },
        totalEstValue: r2(t.estValue + f.estValue),
        history: d.length > 1 ? { from: d[0].date, fromValue: d[0].estValue, to: d[d.length - 1].date, toValue: d[d.length - 1].estValue } : null,
        vsRetail: collectionGain(sets, currency),
        byLocation: group('location'), byCondition: group('condition'), byTheme: group('theme').slice(0, 15),
      };
    },
  },
  {
    name: 'search_sets',
    title: 'Search sets',
    description: 'Find sets in the collection by text (set number, name, theme, location, year) and filters. Returns up to `limit` sets with quantity, copies by status, condition and location (null when copies differ), estimated value per copy and in total, cost basis and gain, retail price and retirement status. Location, condition and status match when any copy matches.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text, e.g. "castle" or "10497"' },
        location: { type: 'string' }, condition: { type: 'string', enum: ['New', 'Used', 'Partial'] }, status: { type: 'string', enum: [...STATUSES] }, theme: { type: 'string' },
        availability: { type: 'string', enum: ['Available', 'Retiring soon', 'Retired'] },
        sort: { type: 'string', enum: ['setNo', 'value', 'name', 'year'], default: 'value' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 25 },
      },
    },
    async run(db, a) {
      const sorts = ['setNo', 'value', 'name', 'year'];
      const f: Filters = { q: str(a.query), location: str(a.location), condition: str(a.condition), status: str(a.status), theme: str(a.theme), availability: str(a.availability), sort: (sorts.includes(str(a.sort)) ? str(a.sort) : 'value') as Filters['sort'] };
      const all = filterSets(await listSets(db), f);
      return { currency: await getCurrency(db), matched: all.length, sets: all.slice(0, int(a.limit, 25, 1, 200)).map(brief) };
    },
  },
  {
    name: 'get_set',
    title: 'Set details',
    description: 'Everything about one set you own: value and BrickLink low/average/high sold prices with the number of sales, recent price history, retail and retirement (Brickset), part-out value (what its parts would sell for), each copy (status, condition, location, dates, cost basis, value and gain), marked missing parts and notes.',
    inputSchema: { type: 'object', properties: { setNo: { type: 'string', description: 'Set number, e.g. 10497 or 10497-1' } }, required: ['setNo'] },
    async run(db, a) {
      const s = await getSet(db, fullSetNo(str(a.setNo, 12)));
      if (!s) throw new Error(`Set ${str(a.setNo, 12)} isn't in the collection.`);
      const currency = await getCurrency(db);
      const [prices, po, unpriced, missing, guides] = await Promise.all([priceHistory(db, s.setNo), partout(db, s.id, guideCondition(s), currency), unpricedLots(db, s.id, guideCondition(s), currency), listMissing(db, s.id, pickCopy(s, null, false)?.id ?? null), brickLinkGuides(db, 'set', s.setNo, currency)]);
      return {
        currency, ...brief(s), notes: s.notes,
        copyList: s.copies.map((c) => ({ id: c.id, status: c.status, condition: c.condition, location: c.location, missingPct: c.missingPct, acquired: c.acquiredDate, built: c.buildDate, costBasis: costBasis(c), giftWithPurchase: c.gwp, estValue: r2(c.estValue), pricedFrom: c.estGuide && c.estGuide !== copyGuide(c) ? (c.estGuide === 'U' ? 'used sales' : 'new sales') : null, notes: c.notes })),
        bricklink: { avgSold: s.avgSold, minSold: s.minSold, maxSold: s.maxSold, sales: s.qtySold, lookedUp: s.lastUpdated, error: s.blError },
        newVsUsed: conditionGap(guides.N, guides.U),
        priceHistory: prices.slice(-12).map((p) => ({ date: p.date, avgSold: p.avgSold })),
        partout: po.lots ? { value: po.value, coveragePct: po.coverage, pricedLots: po.pricedLots, lots: po.lots, unpricedLots: unpriced, ageDays: po.ageDays } : null,
        missingParts: missing.items.map((m) => ({ partNo: m.partNo, name: m.name, color: m.colorName, qty: m.qty })),
      };
    },
  },
  {
    name: 'list_wishlist',
    title: 'Wishlist',
    description: 'Sets on the wishlist with the target price, the current BrickLink average sold price for the wanted condition, whether it is under target, and retail and retirement dates.',
    inputSchema: { type: 'object', properties: {} },
    async run(db) {
      const rows = await listWishlist(db);
      return {
        currency: await getCurrency(db),
        wishlist: rows.map((w) => ({
          setNo: displayNo(w.setNo), name: w.name, condition: w.condition, target: w.target, avgSold: w.avgSold, sales: w.qtySold,
          underTarget: w.target != null && w.avgSold != null && w.avgSold <= w.target, retail: w.retailPrice, retirement: retirement(w), notes: w.notes,
        })),
      };
    },
  },
  {
    name: 'retirement_radar',
    title: 'Retirement Radar',
    description: 'Sets you own or want that are expected to retire, grouped by month (Brickset dates), and retired sets you own ranked by growth per year since retiring (from stored BrickLink prices, or retail when no early price is stored; `thin` marks short history). Flags BrickLink Designer Program and SMART Play sets.',
    inputSchema: { type: 'object', properties: { months: { type: 'integer', minimum: 1, maximum: 60, default: 24, description: 'How many months ahead to include' } } },
    async run(db, a) {
      const r = await getRadar(db);
      const until = new Date(Date.parse(r.today) + int(a.months, 24, 1, 60) * 30.44 * 86_400_000).toISOString().slice(0, 7);
      const item = (i: (typeof r.retired)[number]) => ({ kind: i.kind, setNo: displayNo(i.setNo), name: i.name, flags: i.flags, exitDate: i.exitDate, qty: i.qty, value: r2(i.value), retail: i.retailPrice, gainPct: i.gainPct, growth: i.growth, newOverUsedPct: i.gapPct });
      return { currency: r.currency, today: r.today, totals: r.totals, retiring: r.retiring.filter((m) => m.month <= until).map((m) => ({ month: m.month, items: m.items.map(item) })), retired: r.retired.map(item) };
    },
  },
  {
    name: 'designer_program',
    title: 'Designer Program projects',
    description: 'BrickLink Designer Program projects the owner follows: stage, pre-order window (upcoming, open with days left, closed), price, and whether they own or want the set.',
    inputSchema: { type: 'object', properties: {} },
    async run(db) {
      return { currency: await getCurrency(db), projects: (await listProjects(db)).map(({ openAlertedAt: _o, closeAlertedAt: _c, createdAt: _a, updatedAt: _u, ...p }) => ({ ...p, setNo: p.setNo ? displayNo(p.setNo) : null })) };
    },
  },
  {
    name: 'list_minifigures',
    title: 'Minifigures',
    description: 'Loose minifigures the owner has (not the ones inside sets), with BrickLink numbers, condition, location, quantity and BrickLink average sold price. Optional text filter.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 } } },
    async run(db, a) {
      const q = str(a.query).toLowerCase();
      const rows = (await listMinifigs(db)).filter((m) => !q || [m.figNo, m.rbFigNo, m.name, m.location].some((v) => String(v ?? '').toLowerCase().includes(q)));
      return {
        currency: await getCurrency(db), totals: minifigTotals(rows),
        minifigures: rows.slice(0, int(a.limit, 100, 1, 500)).map((m) => ({ figNo: m.figNo, rebrickableNo: m.rbFigNo, name: m.name, qty: m.qty, condition: m.condition, location: m.location, avgSold: m.avgSold, sales: m.qtySold })),
      };
    },
  },
  {
    name: 'search_parts',
    title: 'Search parts',
    description: 'Search the parts lists of every set you own by part number, part name, color or set number, e.g. "which of my sets have 3001 in red?". Returns matching lines with the set they belong to.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 } }, required: ['query'] },
    async run(db, a) {
      const r = await searchParts(db, { q: str(a.query, 80), limit: int(a.limit, 50, 1, 500) });
      return { total: r.total, parts: r.parts.map((p) => ({ partNo: p.partNo, name: p.name, color: p.colorName, type: p.type, qty: p.qty, alternate: p.alternate, setNo: displayNo(p.setNo), setName: p.setName })) };
    },
  },
  {
    name: 'list_part_lots',
    title: 'Loose parts',
    description: 'Loose parts the owner keeps outside sets (bins, drawers, parted-out sets), searchable by part number, name, colour or location, with what is reserved on each lot for which build.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, location: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 } } },
    async run(db, a) {
      const r = await listLots(db, { q: str(a.query, 80) || undefined, location: str(a.location, 80) || undefined, limit: int(a.limit, 100, 1, 500) });
      return {
        total: r.total, pieces: r.pieces,
        lots: r.lots.map((l) => ({ type: l.type, partNo: l.partNo, name: l.name, color: l.colorName, qty: l.qty, approximate: l.approximate, location: l.location, from: l.from, bricklinkMatch: l.mapped, reserved: l.reserved, reservedFor: l.reservedFor.map((b) => b.name) })),
      };
    },
  },
  {
    name: 'layout_needs',
    title: 'MILS layout parts to buy',
    description: "The owner's MILS layouts (grids of 32 × 32-stud baseplate modules), and for one layout the parts it still needs: each build's whole parts list (parts in the owner's sets are not taken off, since those sets stand on the layout too) plus parts marked missing from linked set copies, totalled by part and colour. Without `layout`, lists the layouts.",
    inputSchema: { type: 'object', properties: { layout: { type: 'string', description: 'Layout name or id' }, limit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 } } },
    async run(db, a) {
      const all = await listLayouts(db);
      const q = str(a.layout, 80).toLowerCase();
      const list = all.map((l) => ({ id: l.id, name: l.name, size: sizeLabel(l.cols, l.rows), modules: l.modules }));
      if (!q) return { layouts: list };
      const l = all.find((x) => String(x.id) === q) ?? all.find((x) => x.name.toLowerCase() === q) ?? all.find((x) => x.name.toLowerCase().includes(q));
      if (!l) return { error: `No layout matches "${str(a.layout, 80)}".`, layouts: list };
      const n = (await layoutNeeds(db, l.id))!;
      return {
        layout: { id: l.id, name: l.name, size: sizeLabel(l.cols, l.rows) }, totals: n.totals, builds: n.builds, setCopies: n.copies, unmappedLines: n.unmapped, buildsWithoutPartsList: n.buildsWithoutParts,
        lines: n.lines.slice(0, int(a.limit, 200, 1, 1000)).map((x) => ({ type: x.type, partNo: x.partNo, color: x.colorName, name: x.name, need: x.need, inLooseParts: x.inLots, toBuy: x.toBuy })),
      };
    },
  },
  {
    name: 'value_history',
    title: 'Value history',
    description: 'Daily totals of the collection (estimated value, sets, copies, pieces) saved after each sync, oldest first.',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 3650, default: 90 } } },
    async run(db, a) {
      const d = dailyHistory(await listHistory(db));
      return { currency: await getCurrency(db), history: d.slice(-int(a.days, 90, 1, 3650)) };
    },
  },
  {
    name: 'lookup_barcode',
    title: 'Look up a barcode',
    description: 'Which set a box barcode (12-digit UPC or 13-digit EAN) belongs to, from barcodes saved by the scanner and the Brickset sync, and whether it is in the collection or on the wishlist. Never asks an outside service; an unknown barcode comes back as not_found.',
    inputSchema: { type: 'object', properties: { barcode: { type: 'string', description: 'Digits under the barcode, e.g. 673419264150' } }, required: ['barcode'] },
    async run(db, a) {
      const r = await resolveBarcode(db, str(a.barcode, 40), { providers: [], readOnly: true });
      if (r.status === 'invalid') throw new Error(r.error);
      return { status: r.status, barcode: r.barcode, candidates: r.candidates.map((c) => ({ setNo: displayNo(c.setNo), name: c.name, year: c.year, source: c.source, confirmed: c.verified, ownedQty: c.owned?.qty ?? 0, onWishlist: c.wished })) };
    },
  },
  {
    name: 'lookup_minifig_code',
    title: 'Look up a minifigure box code',
    description: 'Which Collectible Minifigure is in a box, from the square code on its bottom (e.g. "6472866 444S3"): your confirmed codes, the community list, then a fan-collected table (L-Scan). Says whether you own the figure.',
    inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
    async run(db, a) {
      const r = await resolveFigCode(db, str(a.code, 64));
      if (r.status === 'invalid') throw new Error(r.error);
      return { status: r.status, code: r.code, candidates: r.candidates.map((c) => ({ name: c.name, series: c.series, source: c.source, exactFactory: c.exact, ownedQty: c.owned })) };
    },
  },
];

const INSTRUCTIONS = `${APP_NAME} is a self-hosted tracker for one person's brick-set collection. Values are BrickLink average sold prices (in the collection currency), retail prices and retirement dates come from Brickset, themes from Rebrickable. Every tool is read-only. Say where a number comes from when you quote it, and remember values are market estimates, not appraisals.`;

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json };
type RpcOut = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const fail = (id: Rpc['id'], code: number, message: string): RpcOut => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** Handles one JSON-RPC message. Returns null for notifications (no reply). */
export async function handleRpc(db: DB, msg: Rpc): Promise<RpcOut | null> {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id, -32600, 'Invalid request');
  if (msg.id === undefined || msg.id === null) return null; // notification, e.g. notifications/initialized
  const { id, method, params = {} } = msg;
  switch (method) {
    case 'initialize': {
      const asked = String(params.protocolVersion ?? '');
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: APP_NAME.toLowerCase(), title: APP_NAME, version: VERSION },
          instructions: INSTRUCTIONS,
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return {
        jsonrpc: '2.0', id,
        result: { tools: TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema, annotations: { title, readOnlyHint: true, openWorldHint: false } })) },
      };
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${String(params.name)}`);
      try {
        const data = await tool.run(db, (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Json);
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: false } };
      } catch (e) {
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true } };
      }
    }
    case 'resources/list':
      return { jsonrpc: '2.0', id, result: { resources: [] } };
    case 'prompts/list':
      return { jsonrpc: '2.0', id, result: { prompts: [] } };
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}
