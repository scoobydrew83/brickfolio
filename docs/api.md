# REST API and MCP

Everything the app does is also a JSON API under `/api/v1`, and a read-only MCP server at `/api/mcp` lets Claude and other assistants answer questions about your collection.

- [Tokens](#tokens)
- [Sending a request](#sending-a-request)
- [Reaching the API through Tailscale or Cloudflare Access](#reaching-the-api-through-tailscale-or-cloudflare-access)
- [The OpenAPI description](#the-openapi-description)
- [Routes](#routes)
- [MCP](#mcp)

## Tokens

Create a token in **Settings → API tokens**. It's shown once; the server keeps only its SHA-256 hash.

- A token acts with the current roles of the person who made it, and stops working when they're deleted or taken out of `ALLOWED_USERS`. Tokens made before 0.18.0, or with `AUTH_MODE=none`, have no owner and act as an admin.
- Expiry: never (the default), or 30, 90 or 365 days. Revoking takes effect on the next request.

See [API tokens](install.md#api-tokens) for the details.

## Sending a request

Send the token in either header:

```
Authorization: Bearer <your-token>
x-api-key: <your-token>
```

```bash
curl -H "Authorization: Bearer <your-token>" https://your-host/api/v1/sets
curl -X POST -H "Authorization: Bearer <your-token>" -H "Content-Type: application/json" \
  -d '{"setNo":"10280","name":"Flower Bouquet","condition":"Used"}' https://your-host/api/v1/sets
```

- Bodies and answers are JSON unless the table says otherwise (CSV, XML, PDF, LDraw text). Errors are `{"error": "…"}` with a 4xx or 5xx status.
- A request without a valid token gets 401 ("Unauthorized. Send Authorization: Bearer <api token>."). One the token's owner isn't allowed to make gets 403.
- In the browser, the app's own pages call the same routes with your sign-in instead of a token. Writes without a token from another site are refused.
- `POST /api/v1/prices` and `POST /api/v1/barcodes/batch` need an `Idempotency-Key` header (any unique string up to 100 characters): the same key again returns the first answer with `replayed: true`.
- Many reads take `?collection=<id>` to answer for one collection (see `GET /api/v1/collections`).
- With `DEMO_MODE=on`, every write is refused.

## Reaching the API through Tailscale or Cloudflare Access

The API checks the token itself, but the request still has to reach the server:

- **Tailscale:** run the client on a device in your tailnet.
- **Cloudflare Access:** add a service token or a bypass rule for `/api/v1` (and `/api/mcp`) in the Access application, so scripts get past the login page.

## The OpenAPI description

`GET /api/v1/openapi.json` is an OpenAPI 3.1 description of the API, with request and response schemas. It needs no token. Load it into an API client or a code generator.

## Routes

Paths are under `/api/v1`. `:setNo` takes `10280` or `10280-1`; `:figNo` takes a BrickLink (`sw0001`) or Rebrickable (`fig-000123`) number.

### Sets and copies

| Method | Path | What it does |
|---|---|---|
| GET | `/sets` | Every set, or the sets in one collection with only its copies |
| POST | `/sets` | Add a set with `qty` copies; `another: true` adds a copy of a set you have |
| POST | `/sets/bulk` | Add a pasted list of set and minifigure numbers (`10497 x2`); up to 10 new items are looked up now, the rest at the next sync |
| GET | `/sets/:setNo` | One set, with BrickLink's new vs. used gap |
| PATCH | `/sets/:setNo` | Change the given fields; `qty` adds or removes copies |
| DELETE | `/sets/:setNo` | Remove the newest copy (the set goes with its last one) |
| GET, POST | `/sets/:setNo/copies` | List the set's copies, or add one |
| PATCH, DELETE | `/sets/:setNo/copies/:id` | Change or remove one copy |
| POST | `/sets/:setNo/lookup` | Run the BrickLink lookup for one set again |
| GET | `/sets/:setNo/prices` | Sold prices per day for one set |
| GET | `/sets/:setNo/observations` | Every stored price for a set from every source, newest first (`?source=`, `?type=`) |
| GET | `/sets/:setNo/parts` | The set's parts list with colour names |
| POST | `/sets/:setNo/parts/refresh` | Fetch the parts list again |
| GET | `/sets/:setNo/partout` | What the set would fetch sold as parts, next to its complete value |
| GET, PUT | `/sets/:setNo/missing` | A copy's parts marked missing (`?copy=<id>`), or replace them |
| GET | `/sets/:setNo/missing/wanted.xml` | A copy's missing parts as a BrickLink Wanted List (XML) |
| GET, PUT, DELETE | `/sets/:setNo/model` | The set's LDraw model (text): read, upload or replace (up to 2 MB), or delete |

### Minifigures

| Method | Path | What it does |
|---|---|---|
| GET | `/minifigs` | Every minifigure you own, with BrickLink sold prices and totals |
| POST | `/minifigs` | Add a figure and price it |
| GET, PATCH, DELETE | `/minifigs/:figNo` | One figure: read, change (`collectionId` moves it), or remove one copy |
| GET | `/minifigs/:figNo/observations` | Every stored price for a figure, newest first |

### Wishlist, prices and Radar

| Method | Path | What it does |
|---|---|---|
| GET, POST | `/wishlist` | Every wish with its target and BrickLink sold prices, or add one |
| GET, PATCH, DELETE | `/wishlist/:setNo` | One wish: read, change target, condition, name or notes, or remove it |
| POST | `/prices` | Post retailer offers (or `manual` prices) from your own flow, at most 200; see [alerts.md](alerts.md#deal-alerts-from-retailer-offers) |
| GET | `/prices` | Stored prices for one item (`?id=`, `?type=`, `?source=`, `?days=`) |
| GET | `/radar` | Upcoming retirements by month, retired sets with growth since retiring, and totals |
| GET, POST | `/designer` | BrickLink Designer Program projects you follow, or follow one |
| PATCH, DELETE | `/designer/:id` | Change or remove a project; new dates re-arm its alert |
| GET, PUT | `/settings/value-source` | The source Est. Value comes from, or choose it |

### Parts, builds and layouts

| Method | Path | What it does |
|---|---|---|
| GET | `/parts` | Parts across every set you can see (`?q=`, `?type=`, paged) |
| GET, POST | `/parts/lots` | Loose-part lots with what's reserved on each, or add one |
| PATCH, DELETE | `/parts/lots/:id` | Change or remove a lot (`?force=1` for a reserved one) |
| POST | `/parts/lots/import` | Import BrickLink XML or a Rebrickable parts CSV into one location |
| DELETE | `/parts/lots/import/:batch` | Undo an import |
| GET, POST | `/builds` | Builds and how much of each you can make, or add a MOC or your own build |
| DELETE | `/builds/:mocNo` | Remove a MOC or your own build, with its reservations |
| PUT | `/builds/:mocNo/parts` | Replace a build's parts list (BrickLink XML or a Rebrickable CSV) |
| GET, POST, DELETE | `/builds/:mocNo/reservations` | Loose parts reserved for the build, by lot: list, set, or release |
| POST | `/builds/:mocNo/reservations/auto` | Reserve what the build still needs from free loose parts |
| GET | `/builds/:mocNo/wanted.xml` | The parts you're missing for a build, as a BrickLink Wanted List |
| GET, POST | `/layouts` | Your MILS layouts, or add one |
| GET, PATCH, DELETE | `/layouts/:id` | One layout with its modules: read, change, or delete |
| POST | `/layouts/:id/modules` | Add a module |
| PATCH, DELETE | `/layouts/:id/modules/:moduleId` | Change or remove a module |
| PUT | `/layouts/:id/modules/:moduleId/items` | Replace the set copies and builds standing on a module |
| GET | `/layouts/:id/needs` | Every part the layout still needs |
| POST | `/layouts/:id/reserve` | Reserve loose parts for every build on the layout |
| GET | `/layouts/:id/wanted.xml` | The parts to buy for the layout, as a BrickLink Wanted List |
| GET | `/ldraw/<path>` | One file from the LDraw parts library, for the 3D view |

### Barcodes

| Method | Path | What it does |
|---|---|---|
| GET | `/barcodes` | Which barcode lookups are on, and how many barcodes are saved |
| POST | `/barcodes/lookup` | Find the set for a UPC or EAN |
| POST | `/barcodes/batch` | Add scanned sets to the collection or wishlist, and scanned minifigures (needs `Idempotency-Key`) |
| POST, DELETE | `/barcodes/mappings` | Save "this barcode is that set", or forget a wrong link |
| POST | `/barcodes/minifig` | Find the figure for a Collectible Minifigures box code |
| POST | `/barcodes/minifig/mappings` | Save "this box code is that figure" |
| GET | `/barcodes/offline` | Every saved barcode with what you own and want, for offline scanning |
| GET | `/barcodes/export` | Your own confirmed codes in the community list's format |

### Collection, store and data

| Method | Path | What it does |
|---|---|---|
| GET | `/history` | Totals per day (sets, copies, Est. Value, average sold, pieces), oldest first |
| GET | `/search` | The command palette's search (`?q=`, 2 characters or more) |
| GET, POST | `/collections` | Collections in display order with their counts, or add one |
| PATCH, DELETE | `/collections/:id` | Rename or move a collection, or delete an empty one |
| GET, POST | `/locations` | The location list, or add one |
| GET | `/store` | Your BrickLink store's inventory lots, as of the last sync |
| GET | `/orders` | BrickLink orders (`?direction=in` sold, `out` bought), newest first |
| GET | `/images/:kind/:no` | A set's or minifigure's photo, from the image cache |
| GET | `/export.csv` | Every set (or one collection's) as CSV |
| POST | `/import` | Import a Sets, History or Parts CSV, or a Rebrickable, Brickset or BrickEconomy collection (`text/csv`); `?dryRun=1` previews a collection file without saving |
| GET | `/report.pdf` | The valuation report as a PDF (`?owner=`, `?photos=1`, `?collection=`) |
| GET, POST | `/share-links` | Share links (never the link itself), or create one (the link is returned once) |
| DELETE | `/share-links/:id` | Revoke a share link |

### Sync and server

| Method | Path | What it does |
|---|---|---|
| GET | `/sync` | The latest sync's status |
| POST | `/sync` | Start a full sync in the background (409 while one runs) |
| GET | `/sync/cron` | Start the daily sync from a cron service; takes only `Authorization: Bearer <CRON_SECRET>` (see [The cron endpoint](hosting.md#the-cron-endpoint)) |
| GET | `/version` | The running version and the latest release |
| GET | `/openapi.json` | The OpenAPI 3.1 description (no token needed) |

Outside `/api/v1`, `GET /api/health` answers `{"ok":true}` when the database opens (no token, nothing else revealed), and `/api/mcp` is the MCP server.

## MCP

`/api/mcp` is an MCP server (Streamable HTTP) with the same API tokens. Its tools only read, unless you turn on the write tools (below). They answer only from the collections the token's owner can see.

### Connect

1. Create a token in **Settings → API tokens**.
2. In Claude Code:

   ```bash
   claude mcp add --transport http brickfolio https://your-host/api/mcp --header "Authorization: Bearer <your-token>"
   ```

   Other clients take the same URL and header.

The client has to reach your server, as for the REST API: on Tailscale, run it on a device in your tailnet; behind Cloudflare Access, add a service token or bypass rule for `/api/mcp`.

### Connect with OAuth (Better Auth sign-in)

With `AUTH_MODE=better-auth` and `BETTER_AUTH_URL` set, MCP clients can sign in themselves instead of using an API token: add the server with just its address, for example `claude mcp add --transport http brickfolio https://your-host/api/mcp`, and the client opens a browser to sign in to Brickfolio and approve it.

- The client finds out how from `/.well-known/oauth-protected-resource/api/mcp` and `/.well-known/oauth-authorization-server/api/auth` (OAuth 2.1: authorization code with PKCE, dynamic client registration for public clients).
- **Allow access to Brickfolio?** (`/oauth/consent`) names the client and what it asks for. It gets your role and sees only your collections, as in the app.
- Scopes: `mcp:read` (needed for any tool), `mcp:write` (the write tools, and only with `MCP_WRITE=on`), `offline_access` (a refresh token, so it stays connected).
- Access tokens are signed JWTs for `/api/mcp` only, valid for an hour; the client refreshes them. Someone taken out of `ALLOWED_USERS`, banned or no longer verified is refused at once.
- In the other sign-in modes, use an API token as above. On Tailscale or behind Cloudflare Access, the client still has to reach the server.
- Known limits: with two-factor sign-in on, the authorization doesn't resume after the code step; start the connection again from the client (you're signed in by then).

### Tools

Tools that take `collection` accept a collection name or id; left out, they answer for every collection.

| Tool | What it answers | Arguments |
|---|---|---|
| `list_collections` | The named collections, with how many set copies and minifigures each holds | none |
| `collection_summary` | Totals: sets, copies, minifigures, estimated value, cost basis and gain | `collection` |
| `search_sets` | Sets matching text and filters, with quantity, copies, condition, location and value | `query`, `location`, `condition` (New, Used, Partial), `status`, `theme`, `availability` (Available, Retiring soon, Retired), `sort` (setNo, value, name, year; default value), `limit` (1–200, default 25), `collection` |
| `get_set` | Everything about one set you own: value, sold prices, price history, retail and retirement, part-out value, copies and missing parts | `setNo` (required) |
| `list_wishlist` | Wishes with target, BrickLink average sold price, whether under target, and retail and retirement dates | none |
| `retirement_radar` | Sets you own or want retiring by month, and retired sets ranked by growth per year | `months` (1–60, default 24), `collection` |
| `designer_program` | Designer Program projects you follow: stage, pre-order window, price, whether you own or want the set | none |
| `list_minifigures` | Loose minifigures with BrickLink numbers, condition, location, quantity and average sold price | `query`, `limit` (1–500, default 100), `collection` |
| `search_parts` | Lines in your sets' parts lists matching a part number, name, colour or set number | `query` (required), `limit` (1–500, default 50) |
| `list_part_lots` | Loose-part lots, with what is reserved on each and for which build | `query`, `location`, `limit` (1–500, default 100) |
| `layout_needs` | Your MILS layouts, and for one layout the parts it still needs | `layout` (name or id), `limit` (1–1000, default 200) |
| `value_history` | Daily totals (estimated value, sets, copies, pieces), oldest first | `days` (1–3650, default 90), `collection` |
| `lookup_barcode` | Which set a UPC or EAN belongs to, from saved barcodes only (never asks an outside service), and whether you own or want it | `barcode` (required) |
| `lookup_minifig_code` | Which Collectible Minifigure a box code belongs to, and whether you own it | `code` (required) |

### Write tools (`MCP_WRITE=on`)

With `MCP_WRITE=on` on the server, the assistant can also change the collection. They're off by default; turn them on only for assistants you trust, and expect a client to ask you before each call (they're marked `readOnlyHint: false`, and the removals `destructiveHint: true`). They check permissions like the app: adding needs a collection you can add to, changing a copy needs write access to its collection, and the wishlist needs the `shared` role. They refuse in demo mode.

| Tool | What it does | Arguments |
|---|---|---|
| `add_set` | Adds a set with one or more copies; looked up on BrickLink now when the server has keys, else at the next sync | `setNo` (required), `name`, `qty`, copy fields, `collection` |
| `add_copy` | Adds a copy to a set already in the collection | `setNo` (required), copy fields, `collection` |
| `edit_copy` | Changes a copy, including marking it sold | `copyId` (required, from `get_set` → `copyList`), copy fields |
| `remove_copy` | Deletes a copy (the set goes with its last one) | `copyId` (required) |
| `add_wish` | Puts a set on the wishlist | `setNo` (required), `target`, `condition` (New, Used), `notes` |
| `remove_wish` | Takes a set off the wishlist | `setNo` (required) |

Copy fields: `status` (sealed, built, in_progress, parted_out, sold), `condition`, `location`, `missingPct`, `acquiredDate`, `buildDate`, `pricePaid`, `paidCurrency`, `tax`, `shipping`, `gwp`, `soldDate`, `salePrice`, `saleFees`, `soldVia`, `hasBox`, `hasInstructions`, `stickers` (applied, unapplied, none), `boughtFrom`, `notes`.
