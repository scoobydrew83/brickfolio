# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
