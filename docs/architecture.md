# Architecture

A map of the code for contributors. Read [CONTRIBUTING.md](../CONTRIBUTING.md) for setup, checks and pull requests, and [docs/design.md](design.md) before any UI work.

Brickfolio is one Next.js app. The same code runs on Node (Docker, `npm run dev`, Railway, Render, Vercel) and on Cloudflare Workers (through the OpenNext adapter), against three database drivers.

- [Folders](#folders)
- [Databases](#databases)
- [Migrations](#migrations)
- [The sync](#the-sync)
- [Prices](#prices)
- [Permissions](#permissions)
- [Sign-in modes](#sign-in-modes)
- [The image cache](#the-image-cache)

## Folders

| Path | What's there |
|---|---|
| `app/` | Next.js routes. `actions.ts` holds the server actions the pages call. `share/` is the public read-only share page, `sign-in/`, `reset-password/` and `invite/` are for Better Auth. |
| `app/(app)/` | The signed-in pages: Sets (`page.tsx`), `wishlist`, `minifigs`, `parts`, `build`, `layouts`, `radar`, `scan`, `store`, `orders`, `settings`, `account` |
| `app/api/v1/` | The REST API, one `route.ts` per path (see [api.md](api.md)). `openapi.json/route.ts` describes it. |
| `app/api/mcp/`, `app/api/health/` | The MCP server's endpoint and the health check |
| `components/` | The pages' UI (`SetDetail.tsx`, `WishlistView.tsx`, …) |
| `components/ui/` | Shared components. Views import them from `@/components/ui` (`components/ui/index.ts`). Brickfolio's own components are in `components/ui/kit/`; shadcn writes its lowercase files next to it. See [Adding a component](../CONTRIBUTING.md#adding-a-component) and [design.md](design.md). |
| `lib/sets.ts` | Shared types, validation, filters and totals, with no framework code |
| `lib/service/` | The collection logic. Server actions, the REST API, MCP and the scheduler all call it, so it's where features and their tests go. |
| `lib/db/` | The Drizzle schema (`schema.ts`) and the three drivers (`node.ts`, `d1.ts`, `libsql.ts`), chosen in `index.ts` |
| `lib/bricklink/` | The BrickLink API client with OAuth 1.0a signing, and Wanted List XML |
| `lib/rebrickable/` | The Rebrickable API client and the catalog CSV reader |
| `lib/brickset/` | The Brickset API client (retail prices, dates, barcodes) |
| `lib/ldraw/` | The LDraw parts library and the Official Model Repository, for the 3D view (test fixtures in `fixtures/`) |
| `lib/images/` | The photo cache: a folder or an R2 bucket |
| `lib/email/` | Email providers (SMTP, Resend, Postmark, SES, Cloudflare) and templates |
| `lib/mcp/` | The MCP server's tools |
| `lib/barcode/`, `lib/identifiers/` | Barcode lookups and the community list; the map between BrickLink, Rebrickable, LDraw and other numbers |
| `lib/auth.ts`, `lib/session.ts`, `proxy.ts` | Who is making a request (see [Sign-in modes](#sign-in-modes)) |
| `lib/scheduler.ts`, `instrumentation.ts` | The daily sync and backup on Node, started when the server starts |
| `cloudflare/worker.ts` | The Worker entry: the app plus a Cron Trigger that calls `POST /api/v1/sync` |
| `scripts/` | `seed.mjs` (demo data), `migrate.mjs` (libSQL migrations at build time), `cron-trigger.mjs`, `ldraw-download.mjs`, `screenshots.mjs`, `third-party-notices.mjs`, and the public export |
| `drizzle/` | The SQL migrations, numbered, written by `npm run db:generate` |

## Databases

| Driver | Used by | Selected when |
|---|---|---|
| better-sqlite3 (`lib/db/node.ts`) | Docker, `npm run dev`, Railway, Render with a disk | The default: the file at `DATABASE_PATH` (`./data/app.db`; `/data/app.db` in the image) |
| libSQL (`lib/db/libsql.ts`) | Turso on Vercel and Render free, or a local libSQL file | `DATABASE_URL` starts with `libsql:`, `https:`, `wss:` or `file:`, or `DB_DRIVER=libsql` |
| Cloudflare D1 (`lib/db/d1.ts`) | Cloudflare Workers | `DB_DRIVER=d1`, with the `DB` binding |

All three run the same queries, so write for the strictest:

- **Always `await` database calls.** D1 is async.
- **At most 100 bound parameters per statement on D1.** Split `IN (…)` lists into chunks of about 90, and multi-row inserts with `insertChunked` (`lib/db/chunk.ts`).
- **No interactive transactions on D1.** Write each statement so it's safe on its own.
- Use Web APIs (`fetch`, `crypto.subtle`) rather than Node-only modules outside `lib/db/node.ts` and `lib/scheduler.ts`.

Tests use an in-memory SQLite database (see `lib/service/sets.test.ts`); `npx vitest run --config vitest.libsql.config.mts` runs the same suite against libSQL.

## Migrations

Edit `lib/db/schema.ts`, run `npm run db:generate`, and commit the new file in `drizzle/`. Never edit a released migration.

**Migrations only add:** `CREATE TABLE`, `CREATE INDEX`, `ADD COLUMN`, `INSERT`. Cloudflare D1 ignores `PRAGMA foreign_keys=OFF`, so when Drizzle rebuilds a table (`__new_<table>` in the generated SQL), rebuilding `sets` or `builds` cascades and deletes related rows on D1. Check every generated migration for `__new_`. Dropping an unused column with `ALTER TABLE … DROP COLUMN` is fine.

Migrations run when the Node and libSQL drivers first open the database, during the build on Vercel (`scripts/migrate.mjs`), and with `wrangler d1 migrations apply` on Cloudflare (`npm run cf:deploy`). See [How database changes are applied](upgrading.md#how-database-changes-are-applied).

## The sync

`runSync` in `lib/service/sets.ts` runs the daily sync. It starts from `startSync`, which adds a running row to `sync_runs` as a lock (a second start answers 409) and marks a run left "running" for over 30 minutes as failed. The scheduler (`lib/scheduler.ts`, at `SYNC_HOUR`), the Cloudflare Cron Trigger, `GET /api/v1/sync/cron` and **Sync now** all start the same sync.

In order:

1. **Set lookups:** each set's BrickLink price for its condition (and its parts list the first time, from Rebrickable when it maps). Progress is saved after each set. The loop stops early on BrickLink's daily limit, on maintenance, or when a time limit (`SYNC_TIME_LIMIT`) passes; with a time limit, sets go oldest first.
2. **Minifigure prices**, then **today's history row** (totals for everything and per collection).
3. **Wishlist prices**, then the **under-target** and **price swing** alerts.
4. **Your BrickLink store** and orders.
5. **Catalog steps:** Rebrickable's catalog downloads (the small `owned` import; the `full` import runs after the sync on Node, outside the lock), themes and minifigures, the part and colour ID map, alternate builds, then Brickset retail prices and dates.
6. **The community barcode list**, then the **retirement** and **Designer Program** alerts, and the daily release check.
7. **LDraw models** from the OMR (when a parts library is set up), then **photos** for the image cache.
8. **The other condition's price guide** (new vs. used), then **part prices** for part-out value, each with what's left of the day's BrickLink calls.
9. **The sync problem alert**, and the run's message saved in `sync_runs`.

Each step reports its errors in the message instead of stopping the others. After a time limit passes, only the quick steps still run.

**BrickLink's daily budget.** BrickLink allows 5,000 calls a day; `Budget` in `lib/service/budget.ts` plans for 4,500 and leaves 500 for adding sets by hand. It counts in priority order: sets (2 calls each, plus 1 per parts list from BrickLink), minifigures and the wishlist (2 each), the store (3), then the other price guide (at most `OTHER_GUIDE_DAILY_CALLS`), then part prices (at most `PARTOUT_DAILY_CALLS`) with whatever is left.

## Prices

Every price from every source is a row in `price_observations` (`lib/service/prices.ts`): the item (set or minifigure, by its BrickLink number), source (`bricklink`, `brickset`, `retailer:<name>`, `manual`, …), type (`sold_avg`, `asking`, `estimate`, `retail`, `offer`), condition (`N` or `U`), currency, amount, sample size, date and link. There's one row per item, source, type, condition, currency and day, so the history survives removing and re-adding a set.

Est. Value comes from one primary source, chosen in **Settings → Currency → Value source** (BrickLink by default). Sources are never averaged together; the others are listed next to it. Retail prices and retailer offers can't be the value. Part prices for part-out value are a separate cache, `part_prices`.

## Permissions

`lib/service/permissions.ts` decides what a signed-in person may do, in every sign-in mode:

- **Admins** do everything: Settings, the sync, keys, locations, collections, people and all data. `ADMIN_USERS` names them; when it's unset, everyone allowed in is an admin (except with `AUTH_MODE=better-auth`, where the first account is). The scheduler, `AUTH_MODE=none` and API tokens with no owner act as admins.
- **Everyone else** sees only the collections they have a role in: **viewer** (read), **editor** (add, change and remove items) or **owner** (also members and share links).
- **Shared data** (wishlist, Designer projects, layouts, loose parts, builds, barcodes) can be read by any member and changed by admins and anyone who is an editor or owner somewhere.

Roles live in Better Auth's tables in every mode: each collection is an organization `col_<id>`. API routes say what they need (`api('member' | 'shared' | 'admin', …)` in `lib/api.ts`) and check collections inside the handler.

## Sign-in modes

`AUTH_MODE` (`lib/auth.ts`):

| Mode | Who you are comes from |
|---|---|
| `none` | Nobody signs in; the one user is an admin. Local use only. |
| `tailscale` | The `Tailscale-User-Login` header that `tailscale serve` adds |
| `cloudflare-access` | Cloudflare Access's signed JWT, checked on every request against `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` |
| `better-auth` | Brickfolio's own accounts (`lib/better-auth.ts`): password, emailed links, passkeys, Google, GitHub or Apple |

`ALLOWED_USERS` narrows who may come in. In every mode the REST API and MCP also accept API tokens. `proxy.ts` turns away page requests the mode doesn't recognize; API routes check for themselves so tokens work, and every server action checks the user again.

## The image cache

`lib/images/cache.ts` keeps set and minifigure photos for share pages, offline scanning and the valuation report: in a folder on Node (`IMAGE_CACHE_DIR`, by default `images` next to the database, `/data/images` in Docker) or in the `IMAGE_CACHE` R2 bucket on Cloudflare. `IMAGE_CACHE=off`, or no disk (Vercel without `IMAGE_CACHE_DIR`), passes photos through without keeping them. Only photos from BrickLink's and Rebrickable's image servers are fetched. The daily sync fetches up to `IMAGE_CACHE_WARM` photos ahead of time, and **Settings → Image cache** shows and empties it.
