# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.11.0] - 2026-11-06

**Before upgrading, back up your database.** One migration drops the old `sets` columns `qty`, `condition`, `location` and `missing_pct`, unused since 0.9.0 moved them to copies. It changes the table in place; your sets, copies and prices are kept.

### Added
- **New vs. used:** the daily sync also fetches the other condition's BrickLink price guide for each set (used for a mostly sealed set, new for a built or partial one), about weekly, with one price call each. A set's page shows new and used side by side with sales and dates, and how much more new sells for. The Radar shows it per retired or retiring set and as a median. `OTHER_GUIDE_DAILY_CALLS` caps it (default: sets ÷ 7 + 10, up to 1,000; `0` turns it off). `GET /api/v1/sets/{setNo}` returns `gap`; MCP `get_set` and `retirement_radar` include it.
- **Photos in the valuation report:** **Settings → Valuation report → Include photos** (or `GET /api/v1/report.pdf?photos=1`) adds each item's photo, from the image cache (fetched once if missing). PNG and JPEG photos only.

### Changed
- Each copy is valued from its own condition's newest BrickLink price (within 90 days), so a built copy of a mostly sealed set uses used sales once the other guide is fetched.
- Changing a set's copies only looks it up again when the guide it now needs has no price from the last week, saving BrickLink calls.
- The sync shares BrickLink's daily calls in a fixed order: sets, minifigs, wishlist, store, the other guide, then part prices.
- The docs now mark the BrickEconomy barcode lookup as unverified: BrickEconomy's API needs a Premium subscription, and it was written without the API reference and never tested with a real key.
- BrickLink errors say what's wrong: the daily limit is used up, the keys were rejected, the access token is registered for another IP address, or BrickLink has no such item. BrickLink's own words follow in brackets.
- When BrickLink's daily limit runs out during a sync, the sync stops its BrickLink lookups (the rest keep their last prices) and still does everything else, and the sync message says how far it got.

### Removed
- The `sets` columns `qty`, `condition`, `location` and `missing_pct` (see above).

## [0.10.0] - 2026-11-05

**Before upgrading, back up your database.** One migration moves `price_snapshots` and `minifig_price_snapshots` into the new `price_observations` table and drops the old tables.

### Added
- **Image cache:** set and minifigure photos for share pages and offline scanning are kept on your server after first use: `/data/images` on Docker (in the data volume, safe to delete), an R2 bucket on Cloudflare (binding `IMAGE_CACHE`, see docs/cloudflare.md). Only the photo URL stored on a set or minifigure is ever fetched, only from BrickLink and Rebrickable, up to 2 MB. The daily sync fetches up to `IMAGE_CACHE_WARM` (default 200) missing photos. **Settings → Image cache** shows the count and size and can clear it. `IMAGE_CACHE=off` passes photos through without keeping them. `GET /api/v1/images/{set|minifig}/{no}`.
- Scan page offline: photos of sets and minifigures you own still show without a connection (about 300 kept on the device).
- **Value source:** **Settings → Currency → Value source** chooses the one source Est. Value comes from (BrickLink by default). Sources are never averaged together: with another source, a set it has no value for shows no Est. Value. `GET/PUT /api/v1/settings/value-source`.
- The set page lists **Other sources** under Est. Value, each with its type (sold average, asking, estimate, retail, offer), condition, sample size and date.
- `GET /api/v1/sets/{setNo}/observations` and `GET /api/v1/minifigs/{figNo}/observations`: every stored price, filterable by `source` and `type`.

### Changed
- Share pages load photos from `/share/<link>/img/…` instead of BrickLink, so viewers' browsers never contact BrickLink. Photo requests don't count as views. The Funnel overlay no longer forwards `/_next/image`, and the Cloudflare Access bypass needs only `share` and `_next/static` (a `_next/image` bypass can be removed).
- Every price is stored in one `price_observations` table, keyed by set or minifigure number, source, type, condition, currency and day. Price history now survives removing a set and adding it again, and new and used prices fetched on the same day no longer replace each other. Old snapshots move over as BrickLink sold averages in your Settings currency.
- `GET /api/v1/sets/{setNo}/prices` answers as before; it lists prices in the current currency.

### Fixed
- A copy with no value no longer counts as worth 0: a set's "each" value averages the copies that have one, and gain is shown only when every copy with a price paid also has a value (on cards, the set page and the collection totals).

## [0.9.0] - 2026-11-04

**Before upgrading, back up your database** (Docker keeps daily copies in `/data/backups`). The upgrade runs six migrations: every set becomes one copy per unit of its old quantity (condition New becomes **Sealed**, the rest **Built**), and saved barcodes move from `set_barcodes` into the new `identifiers` table. Collection totals don't change.

### Added
- **Deploy to Cloudflare** button in the README. It copies the repo to your GitHub account, creates the D1 database, asks for the secrets with a description of each, and deploys with Workers Builds. `npm run deploy` runs the Cloudflare deploy (build, migrations, deploy).
- **Share links:** **Settings → Share links** creates a read-only link to your collection for someone without access to the app. Values, locations and notes are off by default; minifigures are on. A link can expire, and revoking it takes effect at once. The link is shown once and stored hashed. `GET/POST /api/v1/share-links`, `DELETE /api/v1/share-links/{id}`. `compose.tailscale-funnel.yml` and Cloudflare Access bypass rules open only `/share` (see the install guide). New `SHARE_BASE_URL`.
- **Copies:** each physical copy of a set is tracked on its own, with a status (Sealed, Built, In progress, Parted out), condition, location, acquired and build dates, cost (price paid, tax, shipping), notes and its own Est. Value. A set's page lists its copies with **Add a copy**, **Edit** and **Remove**. A **Gift with purchase** copy costs 0.
- Cost basis and gain: on the Sets page, each card, a set's page and in MCP `collection_summary`, `search_sets` and `get_set`, over the copies with a price paid.
- A **Status** filter on the Sets page. Location, condition and status filters match a set when any of its copies matches.
- `GET/POST /api/v1/sets/{setNo}/copies`, `PATCH/DELETE /api/v1/sets/{setNo}/copies/{id}`. `POST /api/v1/sets` takes the copy fields (`status`, `acquiredDate`, `buildDate`, `pricePaid`, `tax`, `shipping`, `gwp`, `copyNotes`).
- A part and colour ID map from Rebrickable: with `REBRICKABLE_API_KEY` set, the daily sync (and **Sync Rebrickable now**) saves the BrickLink and LDraw numbers Rebrickable lists for every colour (one call, refreshed monthly) and part (20 pages of 1,000 parts per sync by default, `REBRICKABLE_ID_PAGES_PER_SYNC`; a full pass is about 60 pages, picks up where the last sync stopped and is redone monthly). Alternate builds' parts lists add the mappings they come with, and the Brickset sync keeps Brickset's own set ids.

### Changed
- `wrangler.jsonc` no longer has a placeholder `database_id`: the button fills it in, and CLI deploys add it in step 2. `.dev.vars.example` now lists only secrets. `npm run cf:preview` passes `AUTH_MODE=none` itself.
- App pages moved into the `app/(app)` route group, so share pages render without the app's header and nav. URLs are unchanged.
- Existing sets become `qty` copies on upgrade, keeping condition, location, Missing % and value. Condition **New** becomes status **Sealed**; Used, Partial and blank become **Built**. Change a copy afterwards if it was opened. Collection totals are unchanged.
- Sealed copies are valued with BrickLink's new sold prices and built ones with used prices. Until both guides are fetched, a set fetches the guide most of its copies need (ties go to used); a copy in the other guide uses a snapshot from the last 90 days, or is labelled "priced from new/used sales".
- Marked missing parts belong to a copy. Existing marks move to each set's first copy. `GET/PUT /api/v1/sets/{setNo}/missing` and `.../missing/wanted.xml` take `?copy=<id>` (a PUT needs it when a set has several copies and it isn't clear which).
- `PATCH /api/v1/sets/{setNo}` changes condition, location and Missing % only on a set with one copy; with several it answers 409. `qty` adds copies (cloned from the newest, without cost) or removes the newest. `DELETE` removes the newest copy.
- CSV export has one row per copy (with `copyId`, `status`, dates, cost and `copyNotes`); re-importing it updates those copies. The Google Sheet's format still imports, setting the copy count to `qty`.
- Totals, history, the valuation report, Radar, scan "you own N", Designer and "What can I build?" count copies. Parted out copies aren't counted ("parted out: N" in the Sets header).
- Locations: renaming moves copies, and a location can't be deleted while a copy uses it.
- Wishlist **Got it** adds a copy dated today (sealed when you wanted it New); the action takes an optional price paid.
- `sets.qty`, `condition`, `location` and `missing_pct` are no longer read or written; they're dropped in a later release.
- Saved barcodes moved into a new `identifiers` table, one map from every ID scheme (barcodes, LEGO, BrickLink, Rebrickable, Brickset, LDraw) to the BrickLink ID, with the provider's details in `barcode_details`. Upgrading copies every barcode over, and minifigures with both a BrickLink and a Rebrickable number get a mapping. Scanning, the community list and **Settings → Barcode scanning** work as before.

### Fixed
- Docker images build arm64 on a native runner, so releases publish again. The emulated build ran past its 45-minute limit, so the 0.8.1 images never finished.

## [0.8.1] - 2026-11-04

### Fixed
- Alternate builds whose parts list Rebrickable won't share ("You do not have permission to perform this action") no longer fill Settings with errors or get retried on every sync, which kept the sync from reaching other builds. Each is noted and skipped for 90 days; the sync stops after five refusals in a row when none of your builds' lists come through. **Settings → Rebrickable** counts them, and **What can I build?** lists them with links to Rebrickable.

## [0.8.0] - 2026-11-03

### Added
- **Minifigures** scan mode: the square Data Matrix code on Collectible Minifigures boxes tells you which figure is inside, from your own codes, the community list, then the bundled, fan-collected L-Scan table (MIT), preferring the box's factory and year. Figures are linked to the Rebrickable checklist and added to Minifigures. A figure picked by hand from an opened box is remembered as yours. `POST /api/v1/barcodes/minifig`, `POST /api/v1/barcodes/minifig/mappings` and an MCP `lookup_minifig_code` tool.
- **Read the set number:** OCR (Tesseract.js, in the browser) reads the number printed on a box front, for boxes with an unknown or missing barcode. The model files are served by your own server (`/ocr/…`); on Cloudflare they load from jsDelivr, and `OCR_ASSETS_URL` overrides.
- Offline scanning: the Scan page opens without a connection (service worker, scoped to `/scan`). Known boxes are recognised from saved barcodes kept on the device (`GET /api/v1/barcodes/offline`). Adds wait on the device, clearly marked, and are sent once with an idempotency key when you're back. A **Scan barcodes** home-screen shortcut.
- Community barcode list: reviewed barcodes and minifigure codes in `lib/barcode/data/community.json` (CC0), published from the public repository (github.com/scoobydrew83/brickfolio) and downloaded in the daily sync (`COMMUNITY_LIST`, `COMMUNITY_LIST_URL`). **Settings → Barcode scanning → Share my codes** exports your confirmed codes as a prefilled GitHub issue or a file (`GET /api/v1/barcodes/export`). CONTRIBUTING.md explains the review rules.

### Changed
- `POST /api/v1/barcodes/batch` also takes `figs` (scanned minifigures by Rebrickable number), under the same idempotency key.
- The full sync also refreshes the community list.

## [0.7.0] - 2026-11-03

### Added
- Barcode scanner: **Scan** on the Sets page and Wishlist (and a header icon on phones) reads the UPC or EAN on a box with the camera and finds the set. Decoding runs in the browser (the built-in BarcodeDetector, or ZXing where there isn't one, e.g. iPhone Safari), and no picture is uploaded. **One at a time** shows the set and how many you own, then adds it to the collection or wishlist. **Many in a row** keeps the camera on; a box counts again only after it leaves the frame, and the reviewed list is added in one go.
- Barcodes are saved per installation: ones you confirm, and the EAN/UPC the Brickset sync now keeps for sets you own or want. A box nobody knows asks for its set number once and is remembered.
- Optional lookup services for new boxes: CompareTheBricks (`COMPARETHEBRICKS_API_KEY`, free key) and BrickEconomy (`BRICKECONOMY_API_KEY`, experimental), in the order set by `BARCODE_PROVIDERS`. Only the barcode is sent; misses aren't asked again for 7 days.
- API: `POST /api/v1/barcodes/lookup`, `POST`/`DELETE /api/v1/barcodes/mappings`, `POST /api/v1/barcodes/batch` (with an `Idempotency-Key`, so a retry can't add twice) and `GET /api/v1/barcodes`. The MCP server gets a read-only `lookup_barcode` tool.
- **Settings → Barcode scanning** shows which lookups are on and how many barcodes are saved.

### Changed
- The demo data includes three sample barcodes (made-up codes in the 200… in-store range).

## [0.6.0] - 2026-11-03

### Added
- Valuation report: **Settings → Valuation report** (and `GET /api/v1/report.pdf?owner=`) downloads a PDF of every set and minifigure with condition, location, value per copy and in total, how many BrickLink sales each price rests on and when it was fetched, grouped by location, with totals and how values are worked out.
- BrickLink Designer Program tracker on the Radar page (and `/api/v1/designer`): follow projects from crowdfunding to pre-order with stage, series, designer, dates, price and pieces; see whether you own or want the set and add it to the wishlist. Watched projects alert `DESIGNER_ALERT_DAYS` (default 7) before the pre-order opens and 3 days before it closes.
- MCP server at `/api/mcp` (Streamable HTTP, read-only, API-token auth): tools for the collection summary, set search and details, wishlist, Retirement Radar, Designer Program, minifigures, parts search and value history, so Claude and other assistants can answer questions about the collection.

## [0.5.0] - 2026-11-03

### Added
- Retirement Radar (`/radar`, `/api/v1/radar`): sets you own and wishes grouped by expected retirement month, and retired sets ranked by growth per year since they retired, from your stored BrickLink prices (or the retail price when there's no stored price from around then). BrickLink Designer Program and SMART Play sets are flagged. The Sets page notes sets retiring within six months.
- Retirement alerts: the wishlist webhook warns once when a wish will retire within `RETIRE_ALERT_DAYS` (default 60).
- Minifigures as owned items (`/minifigs`, `/api/v1/minifigs`): add figures by BrickLink number, priced from BrickLink sold history in the daily sync, with condition, location, copies and notes. A Collectible Minifigures checklist loads a series from Rebrickable and ticks off the figures you have.
- Quick add: **Paste a list** on the Sets page (and `POST /api/v1/sets/bulk`) takes set and minifig numbers with counts like `10497 x2`. Up to 10 new items are looked up now; longer lists wait for the next sync.
- Part-out value on set pages (`/api/v1/sets/<number>/partout`): the set priced as parts from BrickLink's part price guide, next to its complete price, with coverage and price age. Part prices are cached for 30 days; the daily sync fetches up to `PARTOUT_DAILY_CALLS` (default 1,500) within the BrickLink budget, and **Price parts now** prices one set.

### Changed
- Once 90% of a Partial set's pieces have part prices, Missing % is weighted by what the missing parts are worth instead of by piece count.
- The demo data includes a Designer Program set, minifigures, a Collectible Minifigures series and part prices.

## [0.4.0] - 2026-11-03

### Added
- Complete your Partial sets: mark missing parts on a set's page. Missing % and Est. Value follow from the pieces, the set becomes Partial, and the missing parts download or copy as a BrickLink Wanted List (`/api/v1/sets/<number>/missing`, `…/missing/wanted.xml`). Marks survive a parts refresh.
- Credits: NOTICE lists every data source and bundled asset, `npm run notices` writes THIRD_PARTY_NOTICES.md, and Settings and the README have a Credits section.

## [0.3.0] - 2026-11-02

### Added
- Brickset integration (`BRICKSET_API_KEY`): original retail price and gain over retail per set and for the collection, a Retiring/Retired chip on sets and wishlist items, an Availability filter, and Settings → Brickset with Test key and Sync now.
- A 3D badge on set cards (and an icon in the table) for sets with an LDraw model; it opens the set page on the 3D tab.

### Changed
- Set cards lead with the set name; the number sits above it. Cards in a row are the same height, with their value boxes lined up.

## [0.2.1] - 2026-11-02

### Changed
- The Coolify compose file (`compose.coolify-tailscale.yml`) runs the published image instead of building on the server, so deploys take seconds. `BRICKFOLIO_IMAGE` pins a release.
- GitHub Actions updated (checkout v7, login-action v4), plus minor and patch dependency updates.

## [0.2.0] - 2026-11-02

### Added
- Set pages (`/sets/<number>`): photo, value and price history, parts list, notes, edit and remove.
- Wishlist with target prices, an "under target" alert, daily re-pricing, "Got it" to move a set into the collection, and `/api/v1/wishlist`.
- Optional Rebrickable sync for themes, subthemes and minifigure counts (`REBRICKABLE_API_KEY`), with a theme filter.
- Light and dark themes with a toggle, a shared app shell, and a phone tab bar.
- `npm run seed` for demo data.
- What can I build?: alternate builds of your sets from Rebrickable, ranked by how many of their parts you own, with a BrickLink Wanted List of what's missing (`/build`, `/api/v1/builds`).
- Settings → 3D models downloads (and updates) the LDraw parts library into `/data/ldraw` with one click; `npm run ldraw:download` does the same from a terminal.
- Demo mode (`DEMO_MODE=on`): a read-only public demo that fills an empty database with sample data, refuses changes and switches off outside services.
- A tour GIF and refreshed screenshots in the README, and `scripts/screenshots.mjs` to retake them.
- Settings → Rebrickable shows matched sets and builds, tests the key, and runs a Rebrickable-only sync. Sets Rebrickable didn't know are asked again after 30 days, and the daily job runs Rebrickable even without BrickLink keys.
- 3D models from LDraw's Official Model Repository: **Find model on LDraw** on a set's page, and the daily sync fetches models for sets that have none (`LDRAW_OMR_SYNC=off` to stop it).
- 3D model view on set pages: upload an LDraw model, orbit it, and step through the build (`LDRAW_LIBRARY_DIR` or `LDRAW_LIBRARY_URL`).
- Wishlist alerts: one message per drop under target to ntfy, Discord or any JSON webhook (`ALERT_WEBHOOK_URL`), and a count on the Wishlist tab.

### Changed
- New visual design (the "instruction booklet" look): design tokens, shared components in `components/ui`, documented in `docs/design.md`.
- Store and Orders lead with their lists instead of big-number tiles.

### Fixed
- Editing a set no longer drops a location that isn't in Settings.
- Keyboard focus is visible everywhere, including the header.

## [0.1.0]

### Added
- Collection tracking with copies, location, condition and missing %.
- BrickLink sold prices, piece counts, photos and parts lists, refreshed by a daily sync.
- Value history, CSV import/export, REST API with tokens and OpenAPI description.
- BrickLink store inventory and orders.
- Docker (with Tailscale or Cloudflare Tunnel) and Cloudflare Workers + D1 deployments.
