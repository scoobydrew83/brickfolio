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
    registered: text('registered'),
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

/**
 * One row per physical copy of a set: sealed, built, in progress or parted out, each with its own condition,
 * location, cost basis and value. `collection_id` has no FK on purpose: adding one later would rebuild the table.
 */
export const setCopies = sqliteTable(
  'set_copies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    setId: integer('set_id').notNull().references(() => sets.id, { onDelete: 'cascade' }),
    collectionId: integer('collection_id'),
    status: text('status', { enum: ['sealed', 'built', 'in_progress', 'parted_out'] }).notNull().default('built'),
    condition: text('condition', { enum: ['New', 'Used', 'Partial'] }).notNull().default('Used'),
    missingPct: real('missing_pct'),
    location: text('location'),
    acquiredDate: text('acquired_date'), // YYYY-MM-DD
    buildDate: text('build_date'), // YYYY-MM-DD
    pricePaid: real('price_paid'), // in the collection currency
    tax: real('tax'),
    shipping: real('shipping'),
    gwp: integer('gwp', { mode: 'boolean' }).notNull().default(false), // gift with purchase: cost basis 0
    estValue: real('est_value'), // cached at the last price, like sets.est_value
    estGuide: text('est_guide', { enum: ['N', 'U'] }), // the guide est_value came from
    notes: text('notes'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [index('set_copies_set').on(t.setId), index('set_copies_collection').on(t.collectionId), index('set_copies_location').on(t.location)],
);

/**
 * Every price from every source, one row per item, source, type, condition, currency and day (a later write that day
 * replaces it). Keyed by the canonical BrickLink number, not a row id, so history survives removing and re-adding a
 * set, and nothing cascades. Parts stay in part_prices.
 */
export const priceObservations = sqliteTable(
  'price_observations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    itemKind: text('item_kind', { enum: ['set', 'minifig'] }).notNull(),
    itemId: text('item_id').notNull(), // 75192-1, sw0001
    source: text('source').notNull(), // bricklink, brickowl, brickeconomy, brickset, manual, retailer:<slug> (parseSource)
    type: text('type', { enum: ['sold_avg', 'asking', 'estimate', 'retail', 'offer'] }).notNull(),
    condition: text('condition', { enum: ['N', 'U'] }).notNull(),
    currency: text('currency').notNull(), // ISO 4217
    amount: real('amount'), // null: the source answered, with no sales
    low: real('low'),
    high: real('high'),
    sampleSize: integer('sample_size'), // sales, listings, …
    observedOn: text('observed_on').notNull(), // YYYY-MM-DD
    observedAt: text('observed_at').notNull(), // ISO time
    url: text('url'),
    sourceRef: text('source_ref'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('price_obs_key').on(t.itemKind, t.itemId, t.source, t.type, t.condition, t.currency, t.observedOn),
    index('price_obs_item').on(t.itemKind, t.itemId, t.observedOn),
    index('price_obs_recent').on(t.type, t.observedOn),
  ],
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
/** Read-only share links. Like API tokens, only the SHA-256 hash is stored; the link is shown once. Revoke = delete. */
export const shareLinks = sqliteTable('share_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  hash: text('hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  showValues: integer('show_values', { mode: 'boolean' }).notNull().default(false),
  showLocations: integer('show_locations', { mode: 'boolean' }).notNull().default(false),
  showNotes: integer('show_notes', { mode: 'boolean' }).notNull().default(false),
  showMinifigs: integer('show_minifigs', { mode: 'boolean' }).notNull().default(true),
  expiresAt: text('expires_at'), // ISO time; null = never
  createdAt: text('created_at').notNull().default(now),
  lastViewedAt: text('last_viewed_at'),
  views: integer('views').notNull().default(0),
});

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
    // The copy the parts are missing from. Nullable in SQL (added by ALTER TABLE), always set by the service.
    copyId: integer('copy_id').references(() => setCopies.id, { onDelete: 'cascade' }),
    partNo: text('part_no').notNull(),
    colorId: integer('color_id').notNull().default(-1), // -1 = no color (minifigs, gear), so the unique key works
    type: text('type').notNull(),
    qty: integer('qty').notNull(),
  },
  (t) => [uniqueIndex('set_missing_parts_copy_key').on(t.copyId, t.type, t.partNo, t.colorId)],
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
    retireAlertedAt: text('retire_alerted_at'), // when a "retires soon" alert was sent; cleared if the date moves away
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
  // Why there's no parts list: Rebrickable refused it ('forbidden', e.g. a private or paid MOC) or doesn't have it.
  // Such builds are skipped until partsCheckedAt is 90 days old (lib/service/builds.ts).
  partsError: text('parts_error', { enum: ['forbidden', 'not_found'] }),
  partsCheckedAt: text('parts_checked_at'),
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

/**
 * Minifigures you own as items of their own (not the ones inside a set). A figure has a BrickLink number
 * (sw0001), which prices it, or only a Rebrickable one (fig-000123) when ticked off the Collectible Minifigures checklist.
 */
export const minifigs = sqliteTable(
  'minifigs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    figNo: text('fig_no'), // BrickLink minifig number, lowercase: sw0001, col25-3
    rbFigNo: text('rb_fig_no'), // Rebrickable number: fig-000123
    name: text('name').notNull(),
    qty: integer('qty').notNull().default(1),
    condition: text('condition', { enum: ['New', 'Used'] }).notNull().default('Used'),
    location: text('location'),
    notes: text('notes'),
    // Filled in by the BrickLink lookup
    blName: text('bl_name'),
    year: integer('year'),
    categoryId: integer('category_id'),
    imageUrl: text('image_url'),
    avgSold: real('avg_sold'),
    minSold: real('min_sold'),
    maxSold: real('max_sold'),
    qtySold: integer('qty_sold'),
    blError: text('bl_error'),
    lastUpdated: text('last_updated'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('minifigs_fig_no').on(t.figNo).where(sql`fig_no is not null`),
    uniqueIndex('minifigs_rb_fig_no').on(t.rbFigNo).where(sql`rb_fig_no is not null`),
  ],
);

/** Rebrickable's figures for each Collectible Minifigures series, cached for the checklist. */
export const cmfFigs = sqliteTable(
  'cmf_figs',
  {
    rbFigNo: text('rb_fig_no').notNull(),
    themeId: integer('theme_id').notNull(),
    name: text('name').notNull(),
    numParts: integer('num_parts'),
    imageUrl: text('image_url'),
    fetchedAt: text('fetched_at').notNull(),
  },
  (t) => [uniqueIndex('cmf_figs_key').on(t.themeId, t.rbFigNo)],
);

/**
 * BrickLink sold prices for single parts (and minifigs inside sets), shared by every set, for part-out value.
 * colorId -1 = no color. Refreshed after 30 days, a capped number per day (PARTOUT_DAILY_CALLS).
 */
export const partPrices = sqliteTable(
  'part_prices',
  {
    type: text('type').notNull(), // PART, MINIFIG, GEAR, …
    partNo: text('part_no').notNull(),
    colorId: integer('color_id').notNull().default(-1),
    guide: text('guide', { enum: ['N', 'U'] }).notNull(),
    currency: text('currency').notNull(),
    avgSold: real('avg_sold'), // null = nothing sold recently
    qtySold: integer('qty_sold'),
    error: text('error'),
    fetchedAt: text('fetched_at').notNull(),
  },
  (t) => [uniqueIndex('part_prices_key').on(t.type, t.partNo, t.colorId, t.guide, t.currency), index('part_prices_fetched').on(t.fetchedAt)],
);

/**
 * BrickLink Designer Program projects you're following: crowdfunding, then a pre-order window, then gone.
 * Entered by hand (or through the API, e.g. from n8n); BrickLink has no API for the program.
 */
export const designerProjects = sqliteTable('designer_projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  setNo: text('set_no'), // BrickLink set number once it has one, e.g. 910038-1
  series: text('series'), // e.g. Series 8
  designer: text('designer'),
  stage: text('stage', { enum: ['crowdfunding', 'selected', 'preorder', 'closed', 'not-made'] }).notNull().default('crowdfunding'),
  preorderStart: text('preorder_start'), // YYYY-MM-DD
  preorderEnd: text('preorder_end'), // YYYY-MM-DD
  price: real('price'), // pre-order price, collection currency
  pieces: integer('pieces'),
  url: text('url'),
  notes: text('notes'),
  watching: integer('watching', { mode: 'boolean' }).notNull().default(true),
  openAlertedAt: text('open_alerted_at'), // "pre-order opens soon" sent
  closeAlertedAt: text('close_alerted_at'), // "pre-order closes soon" sent
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

/** Kinds of item an ID can name, and the catalogs (schemes) that number them. See lib/identifiers. */
export const ID_KINDS = ['set', 'minifig', 'part', 'color', 'element'] as const;
export const ID_SCHEMES = ['lego', 'bricklink', 'rebrickable', 'brickset', 'brickowl', 'brickeconomy', 'ldraw', 'gtin', 'lego_element'] as const;

/**
 * Every ID from every catalog, mapped to one canonical key: the BrickLink ID (75192-1, sw0001, 3001, colour 5, and
 * "3001:5" for an element). Not one-to-one: a barcode can cover regional boxes, and BrickLink merges part molds that
 * Rebrickable splits, so the key includes the canonical ID and the source. Read and written only through lib/identifiers.
 */
export const identifiers = sqliteTable(
  'identifiers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind', { enum: ID_KINDS }).notNull(),
    scheme: text('scheme', { enum: ID_SCHEMES }).notNull(),
    value: text('value').notNull(), // normalised by normalize() in lib/identifiers: GTIN lookup form, lowercase part numbers, set numbers with suffix
    canonical: text('canonical').notNull(), // the BrickLink ID
    source: text('source', { enum: ['user', 'community', 'rebrickable', 'brickset', 'brickowl', 'brickeconomy', 'comparethebricks', 'bricklink'] }).notNull(),
    verified: integer('verified', { mode: 'boolean' }).notNull().default(false), // you confirmed it
    region: text('region'),
    sourceRef: text('source_ref'), // the provider's id for the record
    firstSeenAt: text('first_seen_at').notNull().default(now),
    lastSeenAt: text('last_seen_at').notNull().default(now),
    verifiedAt: text('verified_at'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('identifiers_key').on(t.kind, t.scheme, t.value, t.canonical, t.source),
    index('identifiers_lookup').on(t.kind, t.scheme, t.value),
    index('identifiers_canonical').on(t.kind, t.canonical),
  ],
);

/** What a barcode provider said about a box (scheme 'gtin' rows only): the barcode as scanned, and the set's name and photo. */
export const barcodeDetails = sqliteTable('barcode_details', {
  identifierId: integer('identifier_id').primaryKey().references(() => identifiers.id, { onDelete: 'cascade' }),
  barcode: text('barcode').notNull(), // as scanned or typed, e.g. 673419264150
  format: text('format', { enum: ['UPC_A', 'EAN_13', 'EAN_8', 'UPC_E'] }).notNull(),
  name: text('name'), // what the provider called the set, until it's in the collection
  year: integer('year'),
  pieces: integer('pieces'),
  imageUrl: text('image_url'),
});

/**
 * Codes on Collectible Minifigures boxes (the square Data Matrix): a 7-digit code, plus the factory letter and year digit
 * from the production code, mapped to a figure. Holds yours ('user') and the shared list's ('community'); the fan-made
 * L-Scan table ships with the app (lib/barcode/data/cmf-codes.json) and isn't copied here.
 */
export const minifigCodes = sqliteTable(
  'minifig_codes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code').notNull(), // 6472866
    factory: text('factory').notNull().default(''), // S (Czech Republic), R (Mexico); '' = any
    year: text('year').notNull().default(''), // production year digit; '' = any
    name: text('name').notNull(), // figure name, e.g. Film Noir Detective
    series: text('series').notNull(), // e.g. Series 25
    rbFigNo: text('rb_fig_no'), // Rebrickable number when known: fig-013525
    source: text('source', { enum: ['user', 'community'] }).notNull(),
    verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [uniqueIndex('minifig_codes_key').on(t.code, t.factory, t.year, t.source), index('minifig_codes_code').on(t.code)],
);

/** Barcodes no provider knew, so a box isn't looked up again on every scan. Kept 7 days (lib/barcode/resolve.ts). */
export const barcodeMisses = sqliteTable('barcode_misses', {
  gtin: text('gtin').primaryKey(),
  checkedAt: text('checked_at').notNull(),
});

/** Answers to requests sent with an idempotency key (scan batches), so a retried submit doesn't add sets twice. */
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    key: text('key').primaryKey(),
    result: text('result').notNull(), // JSON
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('idempotency_keys_created').on(t.createdAt)],
);
