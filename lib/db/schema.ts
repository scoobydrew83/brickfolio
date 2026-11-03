// Database schema. Plain SQLite, so the same tables work in a local file (Docker) and in Cloudflare D1.
// After changing it, run `npm run db:generate` to write a migration into ./drizzle.
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const sets = sqliteTable(
  'sets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    setNo: text('set_no').notNull(), // normalized, always with suffix: 10280-1
    name: text('name').notNull(),
    location: text('location'),
    condition: text('condition', { enum: ['New', 'Used', 'Partial'] }),
    registered: text('registered'),
    missingPct: real('missing_pct'),
    qty: integer('qty').notNull().default(1),
    notes: text('notes'),
    // Filled in by the BrickLink lookup
    blName: text('bl_name'),
    year: integer('year'),
    categoryId: integer('category_id'),
    imageUrl: text('image_url'),
    pieces: integer('pieces'),
    partLots: integer('part_lots'),
    avgSold: real('avg_sold'),
    minSold: real('min_sold'),
    maxSold: real('max_sold'),
    qtySold: integer('qty_sold'),
    estValue: real('est_value'),
    blError: text('bl_error'),
    lastUpdated: text('last_updated'),
    // Filled in by the optional Rebrickable sync (catalog data only, never prices)
    themeId: integer('theme_id'),
    minifigs: integer('minifigs'),
    rbSyncedAt: text('rb_synced_at'),
    rbAlternatesAt: text('rb_alternates_at'), // when this set's alternate builds were fetched
    omrCheckedAt: text('omr_checked_at'), // when the LDraw OMR was last asked for this set's model
    // Filled in by the optional Brickset sync: original retail price and availability
    retailPrice: real('retail_price'),
    retailCurrency: text('retail_currency'),
    launchDate: text('launch_date'), // YYYY-MM-DD
    exitDate: text('exit_date'), // YYYY-MM-DD; past = retired, future = expected retirement
    retired: integer('retired', { mode: 'boolean' }),
    bricksetAt: text('brickset_at'), // when Brickset was last asked about this set
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [uniqueIndex('sets_set_no').on(t.setNo)],
);

/** Sold prices per set per day, so a set's value can be charted over time. */
export const priceSnapshots = sqliteTable(
  'price_snapshots',
  {
    setId: integer('set_id').notNull().references(() => sets.id, { onDelete: 'cascade' }),
    date: text('date').notNull(), // YYYY-MM-DD
    guide: text('guide', { enum: ['N', 'U'] }).notNull(),
    avgSold: real('avg_sold'),
    minSold: real('min_sold'),
    maxSold: real('max_sold'),
    qtySold: integer('qty_sold'),
  },
  (t) => [uniqueIndex('price_snapshots_set_date').on(t.setId, t.date)],
);

/** Collection totals, one row per day, written after each sync. */
export const history = sqliteTable('history', {
  date: text('date').primaryKey(), // YYYY-MM-DD
  sets: integer('sets').notNull(),
  copies: integer('copies').notNull(),
  estValue: real('est_value').notNull(),
  avgSold: real('avg_sold').notNull(),
  pieces: integer('pieces').notNull(),
});

export const locations = sqliteTable('locations', {
  name: text('name').primaryKey(),
  sort: integer('sort').notNull().default(0),
});

/** One row per BrickLink sync. A row with no finishedAt is running; it doubles as the lock. */
export const syncRuns = sqliteTable(
  'sync_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    startedAt: text('started_at').notNull().default(now),
    finishedAt: text('finished_at'),
    status: text('status', { enum: ['running', 'done', 'failed'] }).notNull().default('running'),
    total: integer('total').notNull().default(0),
    processed: integer('processed').notNull().default(0),
    errors: integer('errors').notNull().default(0),
    message: text('message'),
  },
  (t) => [
    index('sync_runs_started').on(t.startedAt),
    // At most one running sync: starting a second one fails on this index.
    uniqueIndex('sync_runs_one_running').on(t.status).where(sql`status = 'running'`),
  ],
);

/** Tokens for the REST API (mobile app, scripts). Only a SHA-256 hash is stored. */
export const apiTokens = sqliteTable('api_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  hash: text('hash').notNull().unique(),
  prefix: text('prefix').notNull(), // first characters, so the user can tell tokens apart
  createdAt: text('created_at').notNull().default(now),
  lastUsedAt: text('last_used_at'),
});

/** Key/value settings, e.g. currency. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Your BrickLink store's lots, replaced on each sync (was the sheet's Inventory tab). */
export const storeInventory = sqliteTable('store_inventory', {
  inventoryId: integer('inventory_id').primaryKey(),
  itemNo: text('item_no').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(), // PART, SET, MINIFIG, …
  colorId: integer('color_id'),
  colorName: text('color_name'),
  qty: integer('qty').notNull(),
  condition: text('condition', { enum: ['N', 'U'] }).notNull(),
  unitPrice: real('unit_price'),
  description: text('description'),
  remarks: text('remarks'),
  syncedAt: text('synced_at').notNull(),
});

/** BrickLink orders, replaced on each sync (was the sheet's Orders tab). in = sold, out = bought. */
export const orders = sqliteTable(
  'orders',
  {
    orderId: integer('order_id').notNull(),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    dateOrdered: text('date_ordered'),
    status: text('status').notNull(),
    counterparty: text('counterparty'), // buyer for "in", seller for "out"
    items: integer('items'),
    lots: integer('lots'),
    currency: text('currency'),
    subtotal: real('subtotal'),
    grandTotal: real('grand_total'),
    syncedAt: text('synced_at').notNull(),
  },
  (t) => [uniqueIndex('orders_id_direction').on(t.orderId, t.direction), index('orders_date').on(t.dateOrdered)],
);

/** Each set's parts list from BrickLink (was the sheet's Parts tab). Deleted with its set. */
export const setParts = sqliteTable(
  'set_parts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    setId: integer('set_id').notNull().references(() => sets.id, { onDelete: 'cascade' }),
    matchNo: integer('match_no').notNull().default(0), // groups an alternate with the part it replaces
    partNo: text('part_no').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(), // PART, MINIFIG, GEAR, …
    colorId: integer('color_id'),
    qty: integer('qty').notNull(),
    extra: integer('extra').notNull().default(0),
    alternate: integer('alternate', { mode: 'boolean' }).notNull().default(false),
    counterpart: integer('counterpart', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('set_parts_set').on(t.setId), index('set_parts_part').on(t.partNo)],
);

/** Parts you've marked missing from a Partial set. Kept apart from set_parts, which is replaced on every refresh. */
export const setMissingParts = sqliteTable(
  'set_missing_parts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    setId: integer('set_id').notNull().references(() => sets.id, { onDelete: 'cascade' }),
    partNo: text('part_no').notNull(),
    colorId: integer('color_id').notNull().default(-1), // -1 = no color (minifigs, gear), so the unique key works
    type: text('type').notNull(),
    qty: integer('qty').notNull(),
  },
  (t) => [uniqueIndex('set_missing_parts_key').on(t.setId, t.type, t.partNo, t.colorId)],
);

/** BrickLink color names (the parts list only gives an ID). Filled from GET /colors once. */
export const colors = sqliteTable('colors', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  rgb: text('rgb'),
});

/** Rebrickable themes. Nested: a subtheme points at its parent (e.g. Botanical Collection → Icons). */
export const themes = sqliteTable('themes', {
  id: integer('id').primaryKey(),
  parentId: integer('parent_id'),
  name: text('name').notNull(),
});

/** Sets you want, with the price you'd pay. BrickLink sold prices are refreshed by the daily sync. */
export const wishlist = sqliteTable(
  'wishlist',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    setNo: text('set_no').notNull(), // normalized, with suffix: 10316-1
    name: text('name'),
    condition: text('condition', { enum: ['New', 'Used'] }).notNull().default('New'),
    target: real('target'), // price you'd pay, in the collection currency
    notes: text('notes'),
    year: integer('year'),
    imageUrl: text('image_url'),
    avgSold: real('avg_sold'),
    minSold: real('min_sold'),
    qtySold: integer('qty_sold'),
    blError: text('bl_error'),
    lastUpdated: text('last_updated'),
    alertedAt: text('alerted_at'), // when an "under target" alert was sent; cleared when it goes back above
    // Filled in by the optional Brickset sync: original retail price and availability
    retailPrice: real('retail_price'),
    retailCurrency: text('retail_currency'),
    launchDate: text('launch_date'), // YYYY-MM-DD
    exitDate: text('exit_date'), // YYYY-MM-DD; past = retired, future = expected retirement
    retired: integer('retired', { mode: 'boolean' }),
    bricksetAt: text('brickset_at'), // when Brickset was last asked about this set
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [uniqueIndex('wishlist_set_no').on(t.setNo)],
);

/** An LDraw model (.ldr / .mpd) uploaded for a set, shown in the 3D view. One per set. */
export const setModels = sqliteTable('set_models', {
  setId: integer('set_id').primaryKey().references(() => sets.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  content: text('content').notNull(),
  uploadedAt: text('uploaded_at').notNull().default(now),
});

/** Alternate builds (MOCs) of sets you own, from Rebrickable, for "What can I build?". */
export const builds = sqliteTable('builds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mocNo: text('moc_no').notNull().unique(), // Rebrickable's number, e.g. MOC-12345
  name: text('name').notNull(),
  numParts: integer('num_parts'),
  imageUrl: text('image_url'),
  url: text('url'),
  designer: text('designer'),
  sourceSetNo: text('source_set_no').notNull(), // the owned set it's an alternate build of
  partsFetchedAt: text('parts_fetched_at'),
  fetchedAt: text('fetched_at').notNull().default(now),
});

/** A build's parts, in BrickLink numbers when Rebrickable maps them (`mapped`). */
export const buildParts = sqliteTable(
  'build_parts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    buildId: integer('build_id').notNull().references(() => builds.id, { onDelete: 'cascade' }),
    partNo: text('part_no').notNull(),
    colorId: integer('color_id'),
    qty: integer('qty').notNull(),
    mapped: integer('mapped', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [index('build_parts_build').on(t.buildId)],
);
