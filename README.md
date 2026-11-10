# Brickfolio

A self-hosted tracker for your brick-set collection: what you own, where it is, what condition it's in, and what it's worth based on what sets actually sell for on BrickLink. Your data stays on your server. It works on a phone and can be added to the home screen.

![A tour: the Sets page with its value history and filters, a set page, the wishlist, and dark mode](docs/screenshots/tour.gif)

- **Collection:** set number, name, copies, location, condition (New / Used / Partial), missing %, notes.
- **Finish your Partial sets:** tick the parts a set is missing from its parts list; Missing % and value follow exactly, and the missing parts download as a BrickLink Wanted List.
- **Real sold prices:** BrickLink average, low and high sold prices for each set's condition, less missing pieces. A daily sync keeps them fresh and saves the history.
- **Set pages:** photo, value and price history, the full parts list with counts, notes, and the set's LDraw model in 3D with a step-by-step build view.
- **Retirement Radar:** what you own or want is retiring month by month, and how your retired sets have grown per year since, from Brickset dates and your own stored BrickLink prices. BrickLink Designer Program and SMART Play sets are flagged, and a wishlist set about to retire can send an alert.
- **BrickLink Designer Program tracker:** follow projects from crowdfunding to pre-order, with alerts before the window opens and closes.
- **Valuation report:** a PDF for insurance, with every item's value, where the price came from and when, and totals by location.
- **Ask Claude:** a built-in MCP server (`/api/mcp`) lets Claude and other assistants answer questions about your collection, read-only.
- **Minifigures:** loose figures as items of their own, priced from BrickLink, plus a Collectible Minifigures checklist per series (Rebrickable).
- **New vs. used:** each set's page shows BrickLink's new and used sold prices side by side and how much more new sells for; the Radar shows it per set and as a median. Built and sealed copies are each valued from their own condition.
- **Part-out value:** what a set would fetch sold as parts against its complete price, from BrickLink part prices. Once a set is priced, Missing % is weighted by what the missing parts are worth.
- **Scan barcodes:** point your phone at the barcode on a box to find the set and add it, one at a time or a whole shelf in a row. It also reads the set number off the box, tells you which Collectible Minifigure is in a sealed box from its square code, and works offline. Works without any paid service; a shared community list and optional lookups identify boxes you haven't scanned before.
- **Quick add:** paste a list of set and minifig numbers ("10497 x2") to add them all at once.
- **Wishlist:** sets you want and the price you'd pay; Brickfolio tells you when one sells for less (in the app, or by ntfy, Discord or any webhook), or when a retailer offer your own flow posts is under your target, and "Got it" moves it into your collection.
- **Parts:** every set's parts from BrickLink, searchable across the whole collection.
- **Value vs. retail and a retirement watch** from Brickset (optional, free API key): each set's original price and your gain since, plus which sets you own or want are retiring soon.
- **Themes, minifigs and "What can I build?"** from Rebrickable (optional, with a free API key): alternate builds of your sets ranked by how many of their parts you own, with a BrickLink Wanted List for the rest.
- **Your BrickLink store:** inventory lots with asking value, and orders sold and bought.
- **Open and scriptable:** SQLite on your own server or Cloudflare D1, CSV import/export, and a REST API with tokens and an OpenAPI description.
- **Private by default:** behind Tailscale or Cloudflare Access, with no public login page to attack.

| Sets | Dark mode | On a phone | A set | Wishlist |
|---|---|---|---|---|
| ![The Sets page: the collection's estimated value with its history, filters, and set cards](docs/screenshots/sets-light.png) | ![Sets page in dark mode](docs/screenshots/sets-dark.png) | ![Sets page on a phone](docs/screenshots/phone.png) | ![Set page with value, price history and parts](docs/screenshots/set-detail.png) | ![Wishlist with target prices](docs/screenshots/wishlist.png) |

Screenshots use the demo data from `npm run seed`, so photos are blank and prices are illustrative. `scripts/screenshots.mjs` retakes them.

> LEGO® is a trademark of the LEGO Group, which does not sponsor, authorize or endorse this project.

## Install

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/scoobydrew83/brickfolio)

The button copies Brickfolio to your GitHub account, creates the database and deploys it to Cloudflare Workers, which keeps it up to date from then on. Then put [Cloudflare Access](docs/cloudflare.md#one-click-deploy) in front of it. Until you do, the app refuses every request.

| Setup | Good for | Files you need | Login |
|---|---|---|---|
| [Local only](docs/install.md#local-only) | Trying it out | `docker-compose.yml`, `.env` | None |
| [Docker + Tailscale](docs/install.md#docker--tailscale) | A home server or NAS, used from your own devices | `docker-compose.yml`, `compose.tailscale.yml`, `.env` | Your Tailscale account |
| [Docker + Cloudflare Tunnel](docs/install.md#docker--cloudflare-tunnel) | A home server, reachable from anywhere | `docker-compose.yml`, `compose.cloudflared.yml`, `.env` | Cloudflare Access (email code, Google, …) |
| [Cloudflare Workers + D1](docs/cloudflare.md) (or the button above) | No server at all (free plan works) | The whole repo | Cloudflare Access |

**[docs/install.md](docs/install.md)** has step-by-step instructions for each, including [BrickLink API keys](docs/install.md#get-your-bricklink-api-keys), [Portainer and other Docker GUIs](docs/install.md#portainer-dockge-synology-and-other-docker-guis), [updating](docs/install.md#updating) and [troubleshooting](docs/install.md#troubleshooting).

The Docker setups pull a ready-made image (`ghcr.io/scoobydrew83/brickfolio`, amd64 and arm64), so you only need the compose files and a `.env` on the server. Quick start on your own computer:

```bash
git clone https://github.com/scoobydrew83/brickfolio.git brickfolio && cd brickfolio
cp .env.example .env    # add your BRICKLINK_* keys
docker compose up -d    # then open http://127.0.0.1:3000
```

You'll want **BrickLink API keys** for prices (optional, but most of the point). See [how to get them](docs/install.md#get-your-bricklink-api-keys).

**Just looking?** Fill a database with 20 demo sets, 30 days of value history and a small wishlist, no keys needed:

```bash
npm ci && npm run seed && npm run dev   # http://localhost:3000
```

## Moving from Google Sheets

In Sheets, use **File → Download → Comma-separated values** on the Sets, History and Parts tabs. Then upload each file in **Settings → Import**, Sets first. Importing the Parts tab saves the BrickLink calls needed to fetch every set's parts list again. The original column names (`Lego #`, `Set Name`, `Est. Value`, …) are recognized, and locations that don't exist yet are created. Importing again updates sets by set number, so it's safe to repeat.

## Everyday use

- **Add Set:** looks the set up on BrickLink right away. Adding a set you already own asks before adding another copy.
- **Paste a list:** next to Add set. Up to 10 new items are looked up right away; longer lists are looked up at the next sync.
- **Remove:** takes away the newest copy. On the last copy it deletes the set.
- **Copies:** a set's page lists each copy: sealed, built, in progress or parted out, with its own condition, location, dates, what it cost and its value. **Add a copy**, or tick **Gift with purchase** for one that cost nothing. Cards show "2 sealed · 1 built", the total value and, when you've recorded prices paid, your gain.
- **Sync BrickLink:** refreshes every set, then your store inventory and orders (it also runs daily at `SYNC_HOUR`). Progress shows on the button.
- **Set page:** click a set number or name for its photo, value history, parts list and notes. Prices from other sources are listed under Est. Value with their date and sample size.
- **Value source:** **Settings → Currency → Value source** picks the one source Est. Value comes from (BrickLink by default). Sources are never mixed: a set with no value from the chosen source shows none.
- **Parts:** open a set's parts list from its card, or search every set's parts on the Parts page (e.g. which sets have a given part).
- **Radar:** upcoming retirements by month and growth since retiring. Rates marked * start from the retail price or a short price history.
- **Designer Program:** on the Radar page. **Follow a project**, add its pre-order dates, and the bell turns its alerts on or off.
- **Valuation report:** **Settings → Valuation report** downloads the PDF. Tick **Include photos** for a small photo on every line (from the image cache; it takes longer the first time).
- **Minifigs:** the switch above the Sets page. Add figures by BrickLink number, or pick a Collectible Minifigures series and tick off the ones you have.
- **Part-out value:** on a set's page, under its value. **Price parts now** fetches that set's part prices; the daily sync prices the rest with leftover BrickLink calls.
- **Scan:** **Scan** on the Sets page (or the barcode icon in the header on a phone). **One at a time** to check each box, **Many in a row** to work through a shelf and add the list at once. **Minifigures** reads the square code on Collectible Minifigures boxes. **Read the set number** reads it off the box front. An unknown box asks for its set number once. Offline, scans and adds wait on the phone. See [the install guide](docs/install.md#optional-barcode-scanning).
- **Wishlist:** add a set with the price you'd pay. Sets under your target go to the top; **Got it** moves one into your collection.
- **3D model:** on a set's page, upload its LDraw model (many are in the LDraw Official Model Repository) to orbit it or step through the build. Needs the LDraw parts library; see [the install guide](docs/install.md#optional-3d-models-of-your-sets).
- **Missing parts:** on a set's page, **Mark missing parts** and type how many of each are gone (pick the copy first when you have several). That copy becomes Partial, Missing % is worked out from the pieces, and **Wanted List** downloads them for BrickLink (Want → Upload). Refreshing the parts list keeps your marks.
- **What can I build?:** under Parts. Each build can download its missing parts as a BrickLink Wanted List.
- **Store** and **Orders:** your BrickLink store as of the last sync. Search and filter lots; switch between orders sold and bought.
- **Share a link:** **Settings → Share links** makes a read-only page of your sets for family, friends or an insurer, with values, locations and notes only if you choose. See [the install guide](docs/install.md#share-a-read-only-link) to reach it from outside.
- **Settings:** locations, currency, CSV import/export, share links and API tokens.
- Search, filters and view are kept in the URL, so you can bookmark a view (e.g. your Sell list).

## Data and backups

- Docker keeps the database at `/data/app.db` in the `data` volume, and writes a copy to `/data/backups` daily (keeps `BACKUP_KEEP`, default 7).
- Restore by stopping the app and copying a backup over `app.db`.
- **Settings → About this server** shows the version and whether a newer release is out (a daily check of GitHub's public releases; `UPDATE_CHECK=off` turns it off). See [Updating](docs/install.md#updating).
- **Settings → Download all sets as CSV** gives a portable export at any time.
- Photos for share pages and offline scanning are cached in `/data/images` (R2 on Cloudflare). It can be deleted at any time, or emptied in **Settings → Image cache**; photos are fetched again when needed.

## API

Create a token in **Settings → API tokens**, then:

```bash
curl -H "Authorization: Bearer $TOKEN" https://your-host/api/v1/sets
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"setNo":"10280","name":"Flower Bouquet","condition":"Used"}' https://your-host/api/v1/sets
```

The full description is at `/api/v1/openapi.json` (OpenAPI 3.1): sets CRUD, bulk add, lookup, barcode lookup and scanned batches (`/api/v1/barcodes`), parts lists, part-out value, minifigures, the Retirement Radar, Designer Program projects, a valuation PDF (`/api/v1/report.pdf`), wishlist, retailer offers for deal alerts (`/api/v1/prices`), sync, history, locations, store inventory, orders, import and export.

## Ask Claude (MCP)

`/api/mcp` is a read-only MCP server with the same API tokens. In Claude Code:

```bash
claude mcp add --transport http brickfolio https://your-host/api/mcp --header "Authorization: Bearer $TOKEN"
```

See [the install guide](docs/install.md#optional-ask-claude-about-your-collection-mcp) for the tools and how to reach it through Tailscale or Cloudflare Access.

## Configuration

All settings are environment variables. See [`.env.example`](.env.example) for the full list with comments.

## Development

```bash
npm ci
cp .env.example .env.local
npm run dev            # http://localhost:3000, database in ./data/app.db
npm test               # unit and database tests (Vitest, in-memory SQLite)
npm run seed           # demo data in ./data/app.db (or DATABASE_PATH)
npm run lint
npm run db:generate    # after editing lib/db/schema.ts, writes a migration to ./drizzle
npm run cf:preview     # the app in the local Workers runtime with a local D1
```

How the code is laid out:

```
app/              pages, server actions (actions.ts) and the REST API (api/v1)
components/       pages' UI; shared components in components/ui (see docs/design.md)
lib/sets.ts       shared types, validation, filters and totals (no framework code)
lib/service/      collection logic used by actions, API and scheduler
lib/bricklink/    BrickLink API client with OAuth 1.0a signing
lib/rebrickable/  Rebrickable API client (themes, minifigs, alternate builds)
lib/ldraw/        LDraw parts library access for the 3D view (+ test fixtures)
lib/db/           Drizzle schema and drivers (better-sqlite3 locally, D1 on Cloudflare)
lib/auth.ts       auth modes: none, tailscale, cloudflare-access, plus API tokens
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). The visual design system and roadmap are in [docs/design.md](docs/design.md).

## Credits

Brickfolio stands on other people's work:

- **Data:** [BrickLink](https://www.bricklink.com) for set details, parts lists and sold prices; [Rebrickable](https://rebrickable.com) for themes, minifigures and alternate builds; [Brickset](https://brickset.com) for retail prices and retirement dates; and [LDraw](https://www.ldraw.org) for the parts library and set models (CC BY 2.0, by the LDraw.org contributors). Each service is used with your own key and under its own terms. This app uses the BrickLink API but is not endorsed or certified by BrickLink.
- **Software:** [Next.js](https://nextjs.org), [React](https://react.dev), [three.js](https://threejs.org), [Drizzle ORM](https://orm.drizzle.team), [SQLite](https://sqlite.org) via better-sqlite3, [Lucide](https://lucide.dev) icons and the [Archivo](https://github.com/Omnibus-Type/Archivo) typeface (SIL OFL 1.1).

Every bundled package and its license is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); [NOTICE](NOTICE) has the trademark notes.

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for trademarks and data sources.
