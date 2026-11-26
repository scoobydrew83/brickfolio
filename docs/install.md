# Install Brickfolio

Step-by-step instructions for each setup. Pick one:

| Setup | Good for | Files you need on the server | Login |
|---|---|---|---|
| [Local only](#local-only) | Trying it out on your own computer | `docker-compose.yml`, `.env` | None |
| [Docker + Tailscale](#docker--tailscale) | A home server or NAS, used from your own devices | `docker-compose.yml`, `compose.tailscale.yml`, `.env` | Your Tailscale account |
| [Docker + Cloudflare Tunnel](#docker--cloudflare-tunnel) | A home server, reachable from anywhere | `docker-compose.yml`, `compose.cloudflared.yml`, `.env` | Cloudflare Access (email code, Google, …) |
| [Cloudflare Workers + D1](cloudflare.md) | No server at all (free plan works) | The whole repo (you deploy from it) | Cloudflare Access |
| [Vercel, Railway or Render](hosting.md) | A hosted app without managing a server | The whole repo (you deploy from it) | Brickfolio accounts (Better Auth) |

Using Portainer, Dockge, Synology or similar? Read [Before you start](#before-you-start), pick a setup above, then see [Docker GUIs](#portainer-dockge-synology-and-other-docker-guis). Coolify has its own guide: [coolify.md](coolify.md).

**Guides:**

- [Coolify](coolify.md): the single-file compose resource, variables, volumes and image tags
- [Back up and restore](backup-restore.md): daily backups, restoring, D1 and Turso, testing a restore
- [Troubleshooting](troubleshooting.md): sync and API messages with their causes and fixes
- [Alerts](alerts.md): every alert and channel, the JSON payload, n8n and Home Assistant
- [Upgrading](upgrading.md): each setup, pinning a version, migrations and rolling back
- [REST API and MCP](api.md): tokens, every route and every MCP tool
- [Architecture](architecture.md): how the code is laid out, for contributors
- [FAQ](faq.md): prices, privacy, hosts, Home Assistant and Grafana

- [Before you start](#before-you-start)
- [Local only](#local-only)
- [Docker + Tailscale](#docker--tailscale)
- [Docker + Cloudflare Tunnel](#docker--cloudflare-tunnel)
- [Better Auth sign-in](#better-auth-sign-in)
- [Portainer, Dockge, Synology and other Docker GUIs](#portainer-dockge-synology-and-other-docker-guis)
- [Run a public demo](#run-a-public-demo)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)

## Before you start

### What you need

- **For the Docker setups:** a machine with Docker Engine and Docker Compose **v2.24 or newer** (check with `docker compose version`). The image runs on 64-bit Intel/AMD (`amd64`) and ARM (`arm64`, e.g. Raspberry Pi 4/5 and most recent NAS boxes).
- **For Cloudflare Workers:** a Cloudflare account and Node.js 22 on your computer. See [cloudflare.md](cloudflare.md).
- **BrickLink API keys** (optional, but without them there are no prices, photos or parts lists).

### Get your BrickLink API keys

1. Sign in to BrickLink and open <https://www.bricklink.com/v2/api/register_consumer.page>.
2. Register a consumer (accept the terms). You get a **Consumer Key** and **Consumer Secret**.
3. On the same page, under **Access Tokens**, register a token with **IP address `0.0.0.0`** and **IP mask `0.0.0.0`**. This allows calls from any IP, which you need unless your server has a fixed public IP (Cloudflare Workers never does). You get a **Token Value** and **Token Secret**.
4. These four values go into Brickfolio as:

   | BrickLink calls it | Variable |
   |---|---|
   | Consumer Key | `BRICKLINK_CONSUMER_KEY` |
   | Consumer Secret | `BRICKLINK_CONSUMER_SECRET` |
   | Token Value | `BRICKLINK_TOKEN` |
   | Token Secret | `BRICKLINK_TOKEN_SECRET` |

The API allows 5,000 calls a day. Each set uses 2 per sync, plus 1 the first time to fetch its parts list, so a daily sync covers a couple of thousand sets.

### Optional: Rebrickable key (themes and minifigures)

Brickfolio can add each set's theme (for example *Icons › Botanical Collection*) and minifigure count from [Rebrickable](https://rebrickable.com). Prices still come only from BrickLink.

1. Sign in to Rebrickable, open your profile **Settings → API**, and generate a key.
2. Set it as `REBRICKABLE_API_KEY`.

The Rebrickable part runs at the end of each BrickLink sync. It matches every set once (about two seconds per set, to stay under Rebrickable's rate limit) and then only new sets; sets Rebrickable doesn't know are asked again after 30 days. Once sets have themes, the Sets page shows a Theme filter.

**Settings → Rebrickable** shows how many sets have a theme and how many builds were found. **Test key** makes one call with your key and shows what Rebrickable said. **Sync Rebrickable now** runs just the Rebrickable part, without BrickLink, and asks again about sets it didn't know. Without BrickLink keys, the daily job still runs the Rebrickable part.

If nothing fills in, use **Test key** first. "Invalid token" means the key is wrong. "Couldn't reach rebrickable.com" means the container has no internet access or DNS. "Key not set" means the variable isn't reaching the container: in Coolify, add `REBRICKABLE_API_KEY` in the Environment Variables tab and redeploy.

**Catalog downloads.** With the key, Brickfolio also downloads Rebrickable's free daily catalog files (`cdn.rebrickable.com`, no API calls) once a day, and only when Rebrickable has published a new copy. Sets found there get their theme without an API call, so matching a new set costs one call instead of two.

- **`REBRICKABLE_CATALOG=full`** (the default on Docker): themes, sets, parts, colours, LEGO element IDs (the number on Pick a Brick and in instructions) and every set's inventory. About 17 MB to download and 70 MB in the database. The first import takes a minute or two; later days take a few seconds and only write what changed. It runs after the BrickLink sync, in the background.
- **`owned`**: themes, colours, and only the sets you own, want or have alternate builds of. The default (and the most) on Cloudflare D1, whose free plan allows 100,000 written rows a day.
- **`off`**: no downloads; themes and sets are asked of the API one by one, as before.

LEGO element IDs are matched to BrickLink part and colour numbers through the ID map below, so they fill in over the first few syncs as the map does. **Settings → Rebrickable** lists each file with its rows, date and any error. A file that fails (Rebrickable unreachable, or its columns changed) keeps the copy you had and is tried again at the next sync.

**Parts lists.** With the key, a new set's parts list comes from Rebrickable (its inventory from the catalog downloads when they have the set, else the API, plus one call for its minifigures), turned into BrickLink part and colour numbers through the ID map below, so it costs no BrickLink call. BrickLink's list is used instead when Rebrickable doesn't know the set, or when more than `REBRICKABLE_PARTS_MAX_UNMAPPED` percent of its lots (default 2) have no BrickLink number yet. Rebrickable has no BrickLink minifigure numbers, so a set with a figure Brickfolio hasn't seen yet takes its minifigures from BrickLink's list (one BrickLink call), and Brickfolio remembers which Rebrickable figure is which BrickLink one when it can tell for certain; sets with figures it already knows cost no BrickLink call. The server log says how many lists came from each and how many figures were learned. Lists you already have stay as they are; **Refresh parts list** fetches one again (a set with parts marked missing keeps its list's source, and a refresh that would lose a marked part is refused and says which). Piece counts can differ slightly from BrickLink's. `REBRICKABLE_PARTS=off` keeps every list on BrickLink.

With the same key, each sync also maps Rebrickable's part and colour numbers to BrickLink and LDraw ones: every colour in one call (monthly), and 20 pages of the parts catalog (1,000 parts a page, about a second each) per sync. A full pass is about 60 pages, so it takes three syncs, and is redone every 30 days. `REBRICKABLE_ID_PAGES_PER_SYNC` changes the number of pages; `0` turns it off.

With the same key, each sync also looks up alternate builds of your sets and their parts (at most 40 Rebrickable calls per sync), and **Parts → What can I build?** ranks them by how many of their parts you already own. Each build can export its missing parts as a BrickLink Wanted List (Wanted → Upload on BrickLink).

**Loose parts** (Parts → Loose parts) imports BrickLink XML and Rebrickable parts CSVs. A Rebrickable CSV uses Rebrickable's part and colour numbers; they're matched to BrickLink's through the ID map above, and numbers it doesn't know yet are asked of Rebrickable with this key. Without the key, those lines are kept as they are and don't count in What can I build? until they're matched. **Add a build** with a Rebrickable MOC number also needs the key for its name and parts list (only if the designer shares it). BrickLink XML needs no key. Nothing else to configure.

Rebrickable doesn't share every build's parts list through its API: designers can keep one private or sell it with the instructions, and Rebrickable answers "You do not have permission" for those. Brickfolio notes each such build, skips it, and asks again after 90 days. **Settings → Rebrickable** shows how many there are, and **What can I build?** lists them with a link to each on Rebrickable. If none of your builds' lists come through, the sync stops asking after five refusals, so it doesn't spend calls.

### Optional: Brickset key (retail prices and retirement)

[Brickset](https://brickset.com) knows each set's original retail price and when it launched and retires. With a key, Brickfolio shows:
- each set's retail price and how much it has gained (or lost) since, and the whole collection's gain over retail;
- a **Retiring** chip on sets and wishlist items expected to retire within about six months, and **Retired** once they have;
- an **Availability** filter on the Sets page (Available, Retiring soon, Retired).
- **Building instructions** on each set's page: links to LEGO's instruction PDFs (Brickset's `getInstructions2`, which doesn't use the key's daily limit; kept for a week per server).

1. Sign in to Brickset, open your account's **API** page, and request a key (free for personal use).
2. Set it as `BRICKSET_API_KEY` and restart (in Coolify, add it under Environment Variables and redeploy).

Each sync asks Brickset about sets it hasn't checked in 30 days, 50 sets per call and at most 10 calls, to stay well inside the key's daily limit. Retail prices are stored in your collection currency when Brickset has it (USD, GBP, CAD or EUR), otherwise in USD; the gain is only shown when the currencies match. **Settings → Brickset** shows the counts and has **Test key** and **Sync Brickset now**. Prices you could sell for still come only from BrickLink. Once other price sources are stored, **Settings → Currency → Value source** can choose which one Est. Value uses.

### Optional: barcode scanning

**Scan** (on the Sets page, the Wishlist, and the barcode icon in the header on phones) reads the UPC or EAN barcode on a LEGO box with your phone's camera and finds the set. The camera only works over HTTPS (or `localhost`), which the Tailscale and Cloudflare setups give you. Barcodes are read on the device; no picture leaves it.

Brickfolio finds the set for a barcode, in this order:
1. **Barcodes it already knows:** ones you've confirmed, and the EAN and UPC that the Brickset sync saves for sets you own or want (with `BRICKSET_API_KEY`). Brickset has no barcode search, so it can't identify a box you don't have yet.
2. **A lookup service**, if you've set one up:
   - **[CompareTheBricks](https://comparethebricks.com/en-us/api-access/):** free key (250 lookups a day). Set `COMPARETHEBRICKS_API_KEY`.
   - **[BrickEconomy](https://www.brickeconomy.com/api-reference):** needs a BrickEconomy Premium subscription for the key. Set `BRICKECONOMY_API_KEY`. **Unverified:** the API reference is only visible to Premium members, so this lookup was written without it and hasn't been tested with a real key. It may not work.
   - `BARCODE_PROVIDERS` sets the order (default `comparethebricks,brickeconomy`). `BARCODE_PROVIDER_TIMEOUT_MS` caps each call (default 5000).
3. **The community list:** barcodes other Brickfolio users confirmed and a maintainer reviewed, downloaded in the daily sync (see below).
4. **You:** for a box nobody knows, type the set number (or use **Read the set number**) once and Brickfolio remembers the barcode.

Only the barcode goes to a lookup service, never anything about your collection. A service's answer is kept in your own database so the same box doesn't cost another call, and a barcode none of them knew isn't asked about again for 7 days. These saved answers are a private cache for your installation. Check each service's terms before sharing or publishing them. Barcodes you confirm yourself are stored apart (source `user`).

**One at a time** shows the set, whether you own it already, and adds it to the collection (more copies of a set you have) or the wishlist. **Many in a row** keeps the camera on. A box counts again only after it leaves the frame and comes back. You review the list and add it all at once. The list survives a reload, and a retried submit can't add twice. `BARCODE_SCANNING=off` hides the page.

**Read the set number** reads the big number printed on the front of a box (OCR, with [Tesseract.js](https://github.com/naptha/tesseract.js) in the browser) and lets you pick it. It's handy for a box whose barcode nobody knows, or one with no barcode at all. The model files (about 7 MB, cached after the first use) come from your own server. On Cloudflare Workers, which can't serve them, they load from jsDelivr instead. `OCR_ASSETS_URL` points them somewhere else.

**Minifigures** reads the square code on the bottom of Collectible Minifigures boxes (Series 25 and later, and recent themed series) and shows which figure is inside. The codes come from collectors, not LEGO: Brickfolio ships the [L-Scan](https://github.com/le0pard/lego-scanner) table (MIT), adds the community list and your own codes, and prefers a code from the same factory and year. Treat a match on a sealed box as a good guess. Adding a figure needs its series checklist from Rebrickable (`REBRICKABLE_API_KEY`). When you open a box and the figure differs, **Wrong figure? Pick it** saves the right one as your code.

**Offline:** once you've opened the Scan page, it opens again without a connection (from your phone's home screen too, via the app's **Scan barcodes** shortcut). Boxes whose barcodes are saved are still recognised from a copy kept on the phone; others are looked up when you're back. Anything you add while offline waits on the phone, marked **waiting**, and is sent once you're online. It is never added twice. Minifigure codes are looked up once you're back online.

#### The community list

`lib/barcode/data/community.json` in the [public Brickfolio repository](https://github.com/scoobydrew83/brickfolio) holds barcodes, minifigure box codes and Rebrickable → BrickLink minifigure numbers that users confirmed and a maintainer reviewed, under CC0. The minifigure numbers let parts lists from Rebrickable skip the BrickLink call for figures on the list. Each installation downloads it in the daily sync, or from **Settings → Barcode scanning → Update now**. Only an unchanged-or-not check is sent, nothing about you. Codes in dispute are skipped. Your own confirmations always win over the list. `COMMUNITY_LIST=off` turns it off, and `COMMUNITY_LIST_URL` points at a copy of your own.

To contribute, use **Settings → Barcode scanning → Share my codes**. It exports only the codes you confirmed yourself (barcode and set number, box code and figure: nothing else from your collection) as a prefilled GitHub issue or a file for a pull request. A checkbox (off by default) adds the minifigure numbers your server matched from your sets' parts lists; they're catalogue facts, but they hint at which sets you own. See [CONTRIBUTING.md](../CONTRIBUTING.md#community-barcodes).

### Part-out value and BrickLink's daily limit

A set's page shows what it would fetch sold as parts. With a Rebrickable key, parts lists cost no BrickLink calls (see above), which leaves more for part prices. Each part's price is one BrickLink call, kept for 30 days and shared by every set that uses the part. The daily sync shares BrickLink's 5,000 calls a day, keeping 500 spare, in this order: sets, minifigs and the wishlist (2 calls each), your store, then the other condition's price guide for each set (1 call each, about weekly; at most `OTHER_GUIDE_DAILY_CALLS`, by default your number of sets ÷ 7 plus 10, up to 1,000; `0` turns it off), then part prices with what's left (at most `PARTOUT_DAILY_CALLS`, default 1,500; `0` turns it off). The other guide gives each set's page and the Radar BrickLink's new and used prices side by side, and values a built copy of a mostly sealed set (or the other way round) from its own condition. Most valuable sets go first. **Price parts now** on a set's page prices that set straight away.

### Optional: alerts

After each sync Brickfolio can send one message when wishlist sets drop under your target, when a wish's price swings `PRICE_SWING_PCT` percent (default 10), when a wish retires within `RETIRE_ALERT_DAYS` days, when a followed Designer Program pre-order opens or closes, and when a sync fails or finishes with problems. Your own flows can also post retailer offers to `POST /api/v1/prices` for deal alerts.

Set at least one channel: `ALERT_WEBHOOK_URL` (ntfy, Discord, or JSON for n8n, Home Assistant and the like), `ALERT_EMAIL_TO`, Telegram, Pushover or Gotify. Set `APP_URL` so alerts link back to the app. **Settings → Alerts and sync** has **Send a test alert** and shows the last ten syncs.

[alerts.md](alerts.md) has every alert, every channel, the JSON payload and examples for n8n and Home Assistant.

### Optional: email

Better Auth sign-in (#90) sends password reset, email verification and invitation links by email. Set `EMAIL_PROVIDER` and `EMAIL_FROM` (`Brickfolio <noreply@your-domain>`, an address the provider has verified) plus that provider's keys; until then nothing is sent. Variables are listed in `.env.example`.

| `EMAIL_PROVIDER` | Keys | Notes |
|---|---|---|
| `smtp` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE` | Any mail server or relay (Gmail app password, Fastmail, Mailgun SMTP, your own). Not on Cloudflare Workers. |
| `resend` | `RESEND_API_KEY` | [resend.com](https://resend.com); verify your domain first. |
| `postmark` | `POSTMARK_SERVER_TOKEN` | [postmarkapp.com](https://postmarkapp.com); the sender needs a confirmed Sender Signature or domain. |
| `ses` | `AWS_SES_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Amazon SES v2. New SES accounts can only send to verified addresses until you leave the sandbox. |
| `cloudflare` | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN` | [Cloudflare Email Service](https://developers.cloudflare.com/email-service/) (beta; Workers Paid plan to send to any address, domain on Cloudflare DNS). On Workers a `send_email` binding works without a token: see [cloudflare.md](cloudflare.md#notes). |

Each send waits at most 10 seconds. Failures are reported with the provider's error; the links themselves are never logged.

### Layouts, loose parts and builds: nothing to set up

**Layouts** (the MILS planner, in the menu), **Loose parts** and **What can I build?** (both under **Parts**) need no keys or settings: they're there once the server runs 0.14.0 or later (Settings → About this server shows the version; back up your database before updating, see [Updating](#updating)).

- **Layouts:** **New layout**, give its size in 32 × 32-stud modules, then tap an empty square to add a module. Tap a module to name it, set its type (plain, road, corner, T-junction, crossing), turn it, move it or link the set copies and builds that stand on it. **Parts** below the grid adds up what the layout still needs; **Wanted List** downloads it for BrickLink (Want → Upload).
- **Loose parts** read BrickLink XML with no key. A Rebrickable parts CSV, and MOCs added by number on What can I build?, need the Rebrickable key [above](#optional-rebrickable-key-themes-and-minifigures).
- **What can I build?** lists your own builds with no key; alternate builds of your sets come from Rebrickable with the key, after the next sync.

### Optional: ask Claude about your collection (MCP)

Brickfolio is also an MCP server, at `/api/mcp` on your own address, so Claude (or any assistant that speaks the Model Context Protocol) can answer questions like "what's my most valuable retired set?" or "which sets retire before March?". Its tools are read-only: collection summary, set search and details, wishlist, Retirement Radar, Designer Program, minifigures, parts search, value history and barcode lookup (saved barcodes only).

1. Create a token in **Settings → API tokens**.
2. In Claude Code: `claude mcp add --transport http brickfolio https://your-host/api/mcp --header "Authorization: Bearer <token>"`. Other clients take the same URL and header.

The client has to reach your server: on Tailscale, run it on a device in your tailnet; behind Cloudflare Access, add a service token or bypass rule for `/api/mcp`, as for the REST API.

### Optional: 3D models of your sets

A set's page can show its LDraw model in 3D and step through how it's built. Brickfolio needs two things:

1. **The LDraw parts library** on the server. With Docker or Coolify it lives in the data volume at `/data/ldraw`: open **Settings → 3D models** and click **Download the LDraw library** (about 90 MB; it unzips in the background, and **Update the library** fetches a newer one later). From a terminal instead: `npm run ldraw:download`, or in the container `node scripts/ldraw-download.mjs`.

   To use a copy you already have, unzip `complete.zip` from [library.ldraw.org](https://library.ldraw.org) anywhere and set `LDRAW_LIBRARY_DIR` to that folder (the one with `parts/`, `p/` and `LDConfig.ldr`). On Cloudflare, put the same files in a public bucket and set `LDRAW_LIBRARY_URL` to its address instead. When `LDRAW_LIBRARY_URL` is set it takes precedence over `LDRAW_LIBRARY_DIR`.
2. **A model for each set you want to see.** Many older official sets have one in the [LDraw Official Model Repository](https://library.ldraw.org/omr) (OMR). Brickfolio fetches them for you:
   - On a set's page, open **3D model** and click **Find model on LDraw**.
   - The daily sync also asks the OMR about up to 10 sets that have no model yet, about one a second. Sets the OMR doesn't have are asked again after 30 days. Set `LDRAW_OMR_SYNC=off` to stop this.

   The OMR covers mostly older sets. For anything it doesn't have, upload an `.ldr` or `.mpd` you have on the set's page (3D model → Upload), or `PUT` it to `/api/v1/sets/<number>/model`. Files up to 2 MB.

The library and OMR models are shared under CC BY 2.0 by the LDraw project; a model's author is shown under the 3D view.

### Get the files (Docker setups)

You don't need to build anything. Compose pulls the ready-made image `ghcr.io/scoobydrew83/brickfolio`. You only need the compose files and a `.env`. Either clone the repo:

```bash
git clone https://github.com/scoobydrew83/brickfolio.git brickfolio
cd brickfolio
cp .env.example .env
```

or download just the files:

```bash
mkdir brickfolio && cd brickfolio
base=https://raw.githubusercontent.com/scoobydrew83/brickfolio/main
curl -fsSLO $base/docker-compose.yml
curl -fsSLO $base/compose.tailscale.yml      # only for the Tailscale setup
curl -fsSLO $base/compose.cloudflared.yml    # only for the Cloudflare Tunnel setup
curl -fsSL $base/.env.example -o .env
```

Then open `.env` in an editor and fill in your BrickLink keys. Everything else in it has a sensible default or is covered in the setup steps below.

Everything the app stores lives in the `data` volume: the database, daily backups, the LDraw library and cached photos (`/data/images`, safe to delete; set `IMAGE_CACHE=off` to not keep photos).

**Image tags:** `:latest` is the newest release, `:1.2.3` / `:1.2` pin a release, and `:main` follows the main branch. To choose one, set `BRICKFOLIO_IMAGE=ghcr.io/scoobydrew83/brickfolio:main` in `.env`. To build from source instead, clone the repo and run `docker compose up -d --build`.

## Local only

The app runs on your computer at <http://127.0.0.1:3000> with no login. It is only reachable from that computer.

1. [Get the files](#get-the-files-docker-setups) and add your BrickLink keys to `.env`. Leave `AUTH_MODE=none`.
2. Start it:

   ```bash
   docker compose up -d
   ```

3. Open <http://127.0.0.1:3000>.

To use a different port, set `PORT=8080` (for example) in `.env` and run `docker compose up -d` again.

> Don't change the port binding to reach the app from other devices. `AUTH_MODE=none` means anyone who can reach the port has full access. To use it from your phone or other computers, use the Tailscale or Cloudflare Tunnel setup. You keep your data when you switch.

## Docker + Tailscale

The app gets a private HTTPS address on your tailnet, e.g. `https://brickfolio.tail1234.ts.net`. Only devices signed in to your Tailscale account can reach it, and nothing is published to the internet. A Tailscale container runs next to the app, so the host doesn't need Tailscale installed.

### 1. Prepare your tailnet

In the [Tailscale admin console](https://login.tailscale.com/admin):

1. **Access controls:** add a tag owner to your policy file, so you can create keys for the tag:

   ```json
   "tagOwners": {
     "tag:brickfolio": ["autogroup:admin"]
   }
   ```

   If your policy doesn't use the default "allow all" rule, also let your devices reach the app:

   ```json
   "grants": [
     { "src": ["autogroup:member"], "dst": ["tag:brickfolio"], "ip": ["443"] }
   ]
   ```

2. **DNS:** turn on **MagicDNS** and **HTTPS Certificates**. Note your **tailnet name** (e.g. `tail1234.ts.net`) shown on this page.
3. **Settings → Keys → Generate auth key:**
   - **Reusable:** on
   - **Ephemeral:** off
   - **Tags:** `tag:brickfolio`

   Copy the key (`tskey-auth-…`). It is only used the first time the container signs in. After that the node's identity lives in the `tailscale-state` volume, and tagged nodes don't expire.

### 2. Configure

[Get the files](#get-the-files-docker-setups) including `compose.tailscale.yml`, then set these in `.env`:

```bash
BRICKLINK_CONSUMER_KEY=...           # and the other three BrickLink values
TS_AUTHKEY=tskey-auth-...
COMPOSE_FILE=docker-compose.yml:compose.tailscale.yml    # uncomment this line
# Optional:
TS_HOSTNAME=brickfolio               # the address becomes https://<TS_HOSTNAME>.<tailnet>.ts.net
ALLOWED_USERS=you@example.com        # only these Tailscale logins get in (empty = anyone on the tailnet)
ADMIN_USERS=you@example.com          # the admins; everyone else gets only the collections you give them (see People below)
TZ=Europe/London                     # time zone for history dates and the sync hour
```

`AUTH_MODE` is set to `tailscale` by the overlay, so you don't need to change it.

### 3. Start

```bash
docker compose up -d
docker compose logs -f tailscale     # wait for it to sign in, then Ctrl+C
```

Open `https://brickfolio.<your-tailnet>.ts.net` from any device signed in to your tailnet. The first visit can take a few seconds while Tailscale gets the HTTPS certificate.

The app sees who you are from the `Tailscale-User-Login` header that `tailscale serve` adds. Funnel is off for the app, and the app only listens inside the Tailscale container, so the header can't be faked by another device. If you [share read-only links](#share-a-read-only-link) with the Funnel overlay, Funnel only reaches the share pages on a second port. Those pages ignore identity headers and refuse anything but GET.

## Docker + Cloudflare Tunnel

The app is published at a hostname on your domain, e.g. `https://bricks.example.com`, through an outbound tunnel. No ports are opened on your router. Cloudflare Access asks for a login before anyone reaches the app.

You need a domain whose DNS is on Cloudflare, and a Zero Trust organization (free; the dashboard walks you through creating one the first time you open **Zero Trust**).

### 1. Create the tunnel

1. In the Cloudflare dashboard, open **Zero Trust → Networks → Tunnels → Create a tunnel**. Choose **Cloudflared** and give it a name, e.g. `brickfolio`.
2. On the install screen choose **Docker**. Copy only the token: the long string after `--token` in the command shown. Don't run that command; the compose file runs `cloudflared` for you.
3. Add a **public hostname** (newer dashboards call this a *published application route*):
   - **Subdomain / domain:** e.g. `bricks` . `example.com`
   - **Service type:** `HTTP`
   - **URL:** `app:3000`

### 2. Put Cloudflare Access in front of it

1. **Zero Trust → Access → Applications → Add an application → Self-hosted.**
2. Name it, and add the same hostname as the tunnel (`bricks.example.com`).
3. Add a policy: **Action** Allow, **Include** Emails, and your email address(es).
4. Save. Open the application again and copy the **Application Audience (AUD) Tag**.
5. Note your **team domain**: `<team-name>.cloudflareaccess.com`. The team name is under **Zero Trust → Settings**.

By default Access emails a one-time code to sign in. You can add Google, GitHub and others under **Settings → Authentication**.

### 3. Configure

[Get the files](#get-the-files-docker-setups) including `compose.cloudflared.yml`, then set these in `.env`:

```bash
BRICKLINK_CONSUMER_KEY=...           # and the other three BrickLink values
CLOUDFLARE_TUNNEL_TOKEN=eyJh...
CF_ACCESS_TEAM_DOMAIN=myteam.cloudflareaccess.com
CF_ACCESS_AUD=...                    # the AUD tag from step 2
COMPOSE_FILE=docker-compose.yml:compose.cloudflared.yml  # uncomment this line
# Optional:
ALLOWED_USERS=you@example.com        # a second check on top of the Access policy
ADMIN_USERS=you@example.com          # the admins; everyone else gets only the collections you give them (see People below)
TZ=Europe/London
```

`AUTH_MODE` is set to `cloudflare-access` by the overlay.

### 4. Start

```bash
docker compose up -d
docker compose logs -f cloudflared   # look for "Registered tunnel connection", then Ctrl+C
```

Open `https://bricks.example.com` and sign in through Access.

The app checks Access's signed JWT on every request, so knowing the hostname or the tunnel isn't enough to get in.

## People and permissions

Brickfolio has no logins of its own: Tailscale or Cloudflare Access says who someone is, and `ALLOWED_USERS` (optional) says who may come in at all. `ADMIN_USERS` then says who runs the place:

- **Unset** (the default, and how every earlier version worked): everyone allowed in is an admin and can do everything.
- **Set** to one or more logins: those are the admins. Everyone else starts with nothing until an admin gives them a role in a collection under **Settings → People**: **viewer** (sees it), **editor** (also adds, changes and removes its sets and minifigures) or **owner** (also chooses who else can, and makes share links for it). Admins can also make someone an admin there, on top of `ADMIN_USERS`. People appear in the list after their first visit, or add them beforehand by their Tailscale login or Access email.

### Banning, deleting and other admin tools

Click someone in **Settings → People** (or use the **⋯** menu on their row) for their panel: their role and collections, password, and these. Nobody can ban, delete or act as themselves, or an admin listed in `ADMIN_USERS`; only admins see the panel. Each asks for confirmation first.

- **Ban** (a reason only admins see, and until when: until you unban them, 1, 7 or 30 days, or a date). Their sessions end at once and they can't sign in by any method (password, emailed link, passkey, Google, GitHub or Apple) or use their API tokens until the ban ends. In the Tailscale and Cloudflare Access modes the proxy still lets them through, but Brickfolio gives them no access. **Unban** ends it early.
- **Delete** (type their email to confirm) removes them with their roles in every collection, their invitations (to them and from them), API tokens, passkeys, two-factor and sessions. Their sets stay. With Tailscale or Access, someone the proxy still lets in comes back as a new person with no access on their next visit: ban them, or take them out of `ALLOWED_USERS`.
- **Sessions** (with `AUTH_MODE=better-auth`): where they're signed in (browser and device, address, when it started and was last used), with **End** for one and **End all sessions**. The proxy modes keep no sessions.
- **Reset two-factor**, for someone who lost their authenticator app and backup codes: turns it off and signs them out everywhere. They sign in with their password and can turn it on again.
- **Act as them** (with `AUTH_MODE=better-auth`): see Brickfolio with their rights only, for up to an hour, to check what they can see. Admin settings and admin actions are off meanwhile, and you can't act as an admin or as someone who couldn't sign in themselves. A bar under the header on every page says who you're acting as; **Stop** brings your own session back.

Things the whole install shares (the wishlist, Designer projects, layouts, loose parts, builds and saved barcodes) can be seen by anyone with a role and changed by admins and anyone who is an editor or owner somewhere. Settings, the sync, keys, locations, collections, Store and Orders are for admins. An API token acts with the permissions of the person who made it; tokens made before this version act as an admin, so revoke and remake them if they belong to someone who isn't one (see [API tokens](#api-tokens)). With `AUTH_MODE=none` (no login) the one user is an admin.

## Better Auth sign-in

Brickfolio's own accounts (email and password), for hosts with no Tailscale or Access in front. Set in `.env`:

```bash
AUTH_MODE=better-auth
BETTER_AUTH_SECRET=...   # openssl rand -hex 32
BETTER_AUTH_URL=https://brickfolio.example.com
```

- **The first account is an admin.** Open the app, choose **Create an account**, and sign up. Do it right after deploying: until then anyone who reaches the page can be first.
- **Sign-up is then closed.** With [email](#optional-email) set up, `ALLOWED_USERS` (comma-separated emails) lets those emails create their own account and `BETTER_AUTH_OPEN_SIGNUP=1` lets anyone (they start with no collections). Either way they confirm their address from an emailed link before they can sign in, so nobody can claim an address listed in `ALLOWED_USERS` or `ADMIN_USERS`. Without email, sign-up stays closed (except [with Google or GitHub](#sign-in-with-google--github), which confirm the address themselves). Otherwise an admin adds people in **Settings → People** and gives them a password there (**Set password**) or a **Reset link**. Without email set up, the link is shown once to copy: send it privately, it works like a password for an hour.
- `ADMIN_USERS` still adds admins, and roles work as in [People and permissions](#people-and-permissions).
- **Moving an existing install over:** people keep their roles, but have no password yet. Before switching, set `BETTER_AUTH_SECRET` and give yourself one in **Settings → People → Set password** while signed in the old way. You stay an admin after the switch (even if you were one only because `ADMIN_USERS` was unset), and can then make others admins. Someone removed from `ALLOWED_USERS` is refused by Better Auth's own endpoints (`/api/auth/organization/*`, `/admin/*`, `/api-key/*`) as well as the app.
- **Sign-in links:** with email set up, the sign-in page also offers **Email me a sign-in link**. The link works once, for 10 minutes, and confirms the address. New accounts follow the same rules as above; nothing is sent to an address that couldn't sign in. At most 5 requests per 5 minutes from one IP.
- **Tailscale logins that aren't email addresses** (GitHub logins, `name@github`) can't be Better Auth accounts. Stay on `AUTH_MODE=tailscale` for those.

### Sign in with Google / GitHub

Each provider is on once both its keys are set; the sign-in page then shows **Continue with Google** (GitHub, Apple). The redirect URI is your `BETTER_AUTH_URL` plus `/api/auth/callback/<provider>`, exactly, with no trailing slash.

| Provider | Create the app | Redirect URI | Keys |
|---|---|---|---|
| Google | [Google Cloud console](https://console.cloud.google.com/apis/credentials) → **Create credentials → OAuth client ID → Web application**. Set up the consent screen first (scopes `openid`, `email`, `profile`; nothing sensitive, so no review). | `https://brickfolio.example.com/api/auth/callback/google` under **Authorized redirect URIs** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| GitHub | GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App** (an OAuth App, not a GitHub App). Scopes `read:user` and `user:email` are asked for at sign-in. | `https://brickfolio.example.com/api/auth/callback/github` as **Authorization callback URL** | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| Apple (optional) | [Apple Developer](https://developer.apple.com/account/resources/identifiers/list/serviceId) → a **Services ID** with Sign in with Apple, your domain and the return URL, and a Sign in with Apple **key**. The client secret is a JWT you sign with that key ([Better Auth's guide](https://www.better-auth.com/docs/authentication/apple)); it expires within 6 months, so make a new one before then. | `https://brickfolio.example.com/api/auth/callback/apple` as **Return URL** | `APPLE_CLIENT_ID` (the Services ID), `APPLE_CLIENT_SECRET` (the JWT) |

- **Sign-up rules are the same:** the first account is an admin; after that only emails in `ALLOWED_USERS`, or anyone with `BETTER_AUTH_OPEN_SIGNUP=1`. A provider-verified address counts as confirmed, so this works without email set up. An address the provider hasn't verified gets no account.
- **Existing people** (added by an admin, or moved over from an older install) sign in with a provider account that has the same, verified address; it's linked to them and keeps their roles. Anything else on that not-yet-confirmed account (a password, sessions) is removed first. A provider that hasn't verified the address is never linked. Apple's **Hide My Email** addresses won't match anyone, so they sign up as a new person.
- Someone taken out of `ALLOWED_USERS` can't sign in by any method.
### Passkeys and two-factor

Migration 0036 adds the `passkey` and `two_factor` tables and `user.two_factor_enabled` (new tables and a column; nothing is rebuilt).

- **Passkeys:** signed-in people add them on their account page (a name each; rename or delete them there) and then use **Sign in with a passkey**, or pick one from the browser's autofill. A passkey belongs to the site's hostname, taken from `BETTER_AUTH_URL`: set it to the address people use (it must be HTTPS, or `http://localhost`), and don't change the hostname later, or the passkeys stop working (people can still use their password). Adding one needs a sign-in from the last day.
- **Two-factor:** on the account page, enter your password, scan the QR code with an authenticator app (or type the key), confirm with a code, and save the 10 backup codes shown (once; each works once; **New backup codes** replaces them). From then on, password sign-in and emailed sign-in links ask for a code (**Don't ask again on this device** skips it for 30 days). An emailed link only proves you can read the inbox, so it isn't enough on its own. Turning it off needs the password. Only authenticator-app codes: no SMS or email codes.
- **A passkey sign-in doesn't ask for the two-factor code:** a passkey is already two factors (the device and its PIN or biometric). Neither does a Google, GitHub or Apple sign-in: that account has its own sign-in and two-factor.
- Lost the app and the backup codes? An admin's **Set password** or a **Reset link** doesn't turn two-factor off; an admin's **Reset two-factor** in that person's panel under **Settings → People** does (and signs them out), see [Banning, deleting and other admin tools](#banning-deleting-and-other-admin-tools).
- Someone taken out of `ALLOWED_USERS` (or whose address isn't confirmed) can't sign in with a passkey either, and their existing sessions stop working.
### Inviting people

Admins (to any collection) and a collection's owners (to theirs) can invite someone by email under **Settings → Invitations** (below People; owners find it under their collections' members), as viewer, editor or owner. Viewers and editors can't invite, and Better Auth's own invitation endpoints (`/api/auth/organization/invite-member`, `accept-invitation`, `reject-invitation`, `cancel-invitation`) follow the same rules.

- **With [email](#optional-email)** the invitation is mailed. The link opens `/invite/<id>`, where they sign in, or create an account for that address even while sign-up is closed. A new account confirms its address from an emailed link, which brings them back to accept.
- **Without email** the link is shown to copy and send yourself (**Copy link** in the pending list shows it again). The link by itself proves nothing about who opened it, so it can't create an account: the person needs an account for that address already (for example one you gave a password in **Settings → People**, or a provider sign-in), then signs in and accepts.
- Accepting needs a signed-in, confirmed address that matches the invitation. The role is given with the inviter's rights at that moment: if they've since lost the collection, the invitation no longer works.
- Invitations expire after 7 days, and can be cancelled from the pending list. Inviting the same address again replaces the earlier link. Pending invitations count toward a collection's 90-member limit. An address that `ALLOWED_USERS` leaves out can't be invited.
- Someone already signed in sees their pending invitations on their **Account** page too.

### Your account

The person icon in the header opens **Account** (only with `AUTH_MODE=better-auth`; behind Tailscale or Cloudflare Access it just says who you are, as your login is managed there). It changes your name and your password (which signs out your other sessions), lists where you're signed in (sign out one session, or everywhere else), and lists your sign-in methods (email and password, Google, GitHub). A method can be removed only while another is left, and someone who signs in only through a provider can add a password. The email address can't be changed there: it's your login and what your roles, API tokens and share links are recorded under, so ask an admin.

## API tokens

Scripts, the mobile app, n8n and MCP clients sign in with an API token from **Settings → API tokens**. Send it as `Authorization: Bearer <token>` (or `x-api-key: <token>`) to `/api/v1` or `/api/mcp`. It's shown once; the server keeps only its SHA-256 hash.

- **Whose it is:** a token acts with the current roles of the person who made it, so changing their roles changes what it can do, and it stops working when they're taken out of `ALLOWED_USERS` or deleted. Everyone sees and revokes their own; admins see everyone's.
- **No owner:** tokens made before 0.18.0, or with `AUTH_MODE=none`, belong to nobody and act as an admin. Admins see them as "no owner, acts as admin" and revoke them there; if one belongs to someone who isn't an admin, revoke it and have them make a new one.
- **Expiry:** never (the default), or 30, 90 or 365 days. The list shows when each token was made, last used (recorded at most once a minute) and expires.
- **Revoking** takes effect on the next request.
- **Where they're kept:** Better Auth's apiKey table (`apikey`), in every `AUTH_MODE`. Tokens from earlier versions (the `api_tokens` table) are copied there the first time the server checks or lists a token, and keep working unchanged. `api_tokens` is left as it was, so after going back to an earlier version the tokens from before still work (ones made since don't), and a token revoked here doesn't come back. With `AUTH_MODE=better-auth`, Better Auth's own `/api/auth/api-key/*` endpoints also work, for your own keys only.

## Share a read-only link

**Settings → Share links** creates a link like `https://<host>/share/bfs_…` that shows your sets (and, if you choose, minifigures, values, locations and notes) to anyone who has it. There's no editing, no settings and no API. The link is shown once; revoke it in Settings and it stops working at once. Unknown, revoked and expired links all get the same 404.

The share pages need no login, but your app may not be reachable from the internet. To open only `/share`:

- **Tailscale:** add the Funnel overlay. It funnels a second port, 8443, which proxies only `/share/` (including its photos) and the static files. Port 443 stays on your tailnet.
  1. In the tailnet policy, allow Funnel for the tag: `"nodeAttrs": [{ "target": ["tag:brickfolio"], "attr": ["funnel"] }]`.
  2. Put `COMPOSE_FILE=docker-compose.yml:compose.tailscale.yml:compose.tailscale-funnel.yml` and `SHARE_BASE_URL=https://brickfolio.<tailnet>.ts.net:8443` in `.env`.
  3. Restart. Settings now shows links on port 8443.
- **Cloudflare Access** (Docker tunnel or Workers): in Zero Trust → Access → Applications, add self-hosted applications for the same hostname with paths `share` and `_next/static`, each with one policy: **Action: Bypass, Include: Everyone**. The more specific path wins over the main application. Without the static files the page loads without styles. Photos come from `/share/<link>/img/…`, which checks the link, so nothing else needs to be open. (A `_next/image` bypass from 0.9.0 can be removed.)

`SHARE_BASE_URL` sets the address used in new links. It defaults to `APP_URL`, then to the address you opened Settings on.

## Portainer, Dockge, Synology and other Docker GUIs

The setups above work in Docker GUIs too. Enter the variables from the setup's **Configure** step in the tool's environment-variable screen instead of a `.env` file. `docker-compose.yml` passes them to the app. Skip `COMPOSE_FILE`; these tools choose the compose files themselves.

**Portainer** (Stacks → Add stack → **Repository**):

| Field | Value |
|---|---|
| Repository URL | `https://github.com/scoobydrew83/brickfolio` |
| Repository reference | `refs/heads/main` |
| Compose path | `docker-compose.yml` |
| Additional paths | `compose.tailscale.yml` *or* `compose.cloudflared.yml` (leave empty for local only) |
| Environment variables | Your BrickLink keys plus the setup's variables (`TS_AUTHKEY`, or `CLOUDFLARE_TUNNEL_TOKEN`, `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`) |

Turn on **GitOps updates** if you want Portainer to redeploy when the repo changes.

**Coolify with Tailscale** (full guide: [coolify.md](coolify.md)): Coolify takes a single compose file, so the repo ships a ready-merged one, `compose.coolify-tailscale.yml`. Create a Git-based Docker Compose resource and set its compose location to `/compose.coolify-tailscale.yml`. It runs the published image `ghcr.io/scoobydrew83/brickfolio:latest`, so deploys only pull and restart; set `BRICKFOLIO_IMAGE` to pin a release (for example `ghcr.io/scoobydrew83/brickfolio:0.2`), or replace `image:` and `pull_policy:` under `app` with `build: .` and `pull_policy: build` to build from source. The file also works pasted into a **Docker Compose Empty** resource. Add `TS_AUTHKEY`, `ALLOWED_USERS` and the four `BRICKLINK_*` values under Environment Variables, plus any optional ones (`REBRICKABLE_API_KEY`, `ALERT_WEBHOOK_URL` or another alert channel, `APP_URL`, `TZ`). Coolify passes only the variables the compose file lists; if one you set seems ignored, check it's under `environment:` in that file. To update, redeploy in Coolify: it pulls the newest image. Don't assign a domain in Coolify: the app is only served at `https://brickfolio.<your-tailnet>.ts.net`.

**Other tools that take a single compose file** (Dockge, Synology Container Manager, Coolify with Cloudflare, …): on any machine with Docker, merge the base file and the overlay into one file:

```bash
docker compose -f docker-compose.yml -f compose.tailscale.yml config --no-interpolate > brickfolio.yml
```

Open `brickfolio.yml`, delete the `build:` and `env_file:` blocks under `app` (they hold paths from the machine you ran this on), then paste it into the tool and add the variables in its environment screen.

## Run a public demo

`DEMO_MODE=on` turns an install into a read-only demo anyone can browse:
- An empty database is filled with the demo data from `npm run seed` on first start.
- Adding, editing, importing, syncing and API writes are refused with a short message.
- BrickLink, Rebrickable and alerts are switched off, even if keys are set.
- A strip under the header says it's a demo and links to this guide.

Run it with no login and a public address, for example on its own Docker host or a Coolify resource with a domain:

```bash
docker run -d -p 3000:3000 -e DEMO_MODE=on -e AUTH_MODE=none -v brickfolio-demo:/data ghcr.io/scoobydrew83/brickfolio:latest
```

Don't turn demo mode on for your own collection: it stops all changes and syncs. On Cloudflare Workers, demo mode works the same, but D1 isn't seeded automatically; load it from a local `npm run seed` database instead.

## Updating

**Settings → About this server** shows the version you're running and, once a day, checks GitHub for a newer release (`UPDATE_CHECK=off` turns it off). On Docker, back up your database, then:

```bash
docker compose pull
docker compose up -d
```

[upgrading.md](upgrading.md) has the steps for every setup (Coolify, Docker GUIs, Cloudflare Workers, Vercel, Railway and Render), pinning a version with `BRICKFOLIO_IMAGE`, and how to roll back. Backups are in [backup-restore.md](backup-restore.md).

## Troubleshooting

Messages from installing, signing in, the sync, the other services and alerts, with their causes and fixes, are in [troubleshooting.md](troubleshooting.md).
