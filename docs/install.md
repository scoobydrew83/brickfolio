# Install Brickfolio

Step-by-step instructions for each setup. Pick one:

| Setup | Good for | Files you need on the server | Login |
|---|---|---|---|
| [Local only](#local-only) | Trying it out on your own computer | `docker-compose.yml`, `.env` | None |
| [Docker + Tailscale](#docker--tailscale) | A home server or NAS, used from your own devices | `docker-compose.yml`, `compose.tailscale.yml`, `.env` | Your Tailscale account |
| [Docker + Cloudflare Tunnel](#docker--cloudflare-tunnel) | A home server, reachable from anywhere | `docker-compose.yml`, `compose.cloudflared.yml`, `.env` | Cloudflare Access (email code, Google, …) |
| [Cloudflare Workers + D1](cloudflare.md) | No server at all (free plan works) | The whole repo (you deploy from it) | Cloudflare Access |

Using Portainer, Dockge, Synology or similar? Read [Before you start](#before-you-start), pick a setup above, then see [Docker GUIs](#portainer-dockge-synology-and-other-docker-guis).

- [Before you start](#before-you-start)
- [Local only](#local-only)
- [Docker + Tailscale](#docker--tailscale)
- [Docker + Cloudflare Tunnel](#docker--cloudflare-tunnel)
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

With the same key, each sync also maps Rebrickable's part and colour numbers to BrickLink and LDraw ones: every colour in one call (monthly), and 20 pages of the parts catalog (1,000 parts a page, about a second each) per sync. A full pass is about 60 pages, so it takes three syncs, and is redone every 30 days. `REBRICKABLE_ID_PAGES_PER_SYNC` changes the number of pages; `0` turns it off.

With the same key, each sync also looks up alternate builds of your sets and their parts (at most 40 Rebrickable calls per sync), and **Parts → What can I build?** ranks them by how many of their parts you already own. Each build can export its missing parts as a BrickLink Wanted List (Wanted → Upload on BrickLink).

Rebrickable doesn't share every build's parts list through its API: designers can keep one private or sell it with the instructions, and Rebrickable answers "You do not have permission" for those. Brickfolio notes each such build, skips it, and asks again after 90 days. **Settings → Rebrickable** shows how many there are, and **What can I build?** lists them with a link to each on Rebrickable. If none of your builds' lists come through, the sync stops asking after five refusals, so it doesn't spend calls.

### Optional: Brickset key (retail prices and retirement)

[Brickset](https://brickset.com) knows each set's original retail price and when it launched and retires. With a key, Brickfolio shows:
- each set's retail price and how much it has gained (or lost) since, and the whole collection's gain over retail;
- a **Retiring** chip on sets and wishlist items expected to retire within about six months, and **Retired** once they have;
- an **Availability** filter on the Sets page (Available, Retiring soon, Retired).

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

`lib/barcode/data/community.json` in the [public Brickfolio repository](https://github.com/scoobydrew83/brickfolio) holds barcodes and minifigure codes that users confirmed and a maintainer reviewed, under CC0. Each installation downloads it in the daily sync, or from **Settings → Barcode scanning → Update now**. Only an unchanged-or-not check is sent, nothing about you. Codes in dispute are skipped. Your own confirmations always win over the list. `COMMUNITY_LIST=off` turns it off, and `COMMUNITY_LIST_URL` points at a copy of your own.

To contribute, use **Settings → Barcode scanning → Share my codes**. It exports only the codes you confirmed yourself (barcode and set number, box code and figure: nothing else from your collection) as a prefilled GitHub issue or a file for a pull request. See [CONTRIBUTING.md](../CONTRIBUTING.md#community-barcodes).

### Part-out value and BrickLink's daily limit

A set's page shows what it would fetch sold as parts. Each part's price is one BrickLink call, kept for 30 days and shared by every set that uses the part. The daily sync shares BrickLink's 5,000 calls a day, keeping 500 spare, in this order: sets, minifigs and the wishlist (2 calls each), your store, then the other condition's price guide for each set (1 call each, about weekly; at most `OTHER_GUIDE_DAILY_CALLS`, by default your number of sets ÷ 7 plus 10, up to 1,000; `0` turns it off), then part prices with what's left (at most `PARTOUT_DAILY_CALLS`, default 1,500; `0` turns it off). The other guide gives each set's page and the Radar BrickLink's new and used prices side by side, and values a built copy of a mostly sealed set (or the other way round) from its own condition. Most valuable sets go first. **Price parts now** on a set's page prices that set straight away.

### Optional: wishlist alerts

After each sync Brickfolio can send one message listing wishlist sets whose average sold price dropped under your target. It alerts once per drop; a set that goes back above target alerts again the next time it drops.

- **Phone push with [ntfy](https://ntfy.sh):** install the ntfy app, subscribe to a long random topic name, and set `ALERT_WEBHOOK_URL=https://ntfy.sh/<that-topic>` (or your own ntfy server).
- **Discord:** create a webhook in a channel's settings and use its URL.
- **Anything else:** any URL that accepts a JSON POST (`{title, message, url, items}`); Home Assistant, n8n and Zapier all do.

With a Brickset key, the same webhook also warns once when a wishlist set will retire within `RETIRE_ALERT_DAYS` days (default 60; `0` turns it off), and again if its date moves away and back.

Watched BrickLink Designer Program projects (Radar → Designer Program) alert `DESIGNER_ALERT_DAYS` days before their pre-order opens (default 7; `0` turns it off) and 3 days before it closes.

**Deal alerts from retailer offers.** Your own flow (n8n, a script, a spreadsheet) can post offers it finds to `POST /api/v1/prices`. When the lowest recent offer for a wish, in its condition and your currency, is at or under your target, the same webhook alerts once, naming the retailer and linking to the offer. The Wishlist page shows the best offer next to the BrickLink price. Offers count for `OFFER_MAX_AGE_DAYS` (default 3) and never change Est. Value. Brickfolio doesn't scrape stores; feed it only from sources you're allowed to use.

1. Create a token in **Settings → API tokens**.
2. Post a batch (at most 200) with an `Idempotency-Key` header, so a retried run doesn't post twice:
   ```bash
   curl -X POST https://your-host/api/v1/prices -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -H "Idempotency-Key: deals-2026-11-06-12" \
     -d '{"observations":[{"id":"75192","source":"retailer:lego","type":"offer","condition":"N","currency":"USD","amount":599.99,"url":"https://www.lego.com/…"}]}'
   ```
   `id` can be a set number (`75192` or `75192-1`) or the box barcode. `source` is `retailer:<name>` or `manual`; the sources the app syncs itself (BrickLink, Brickset and so on) are refused. The answer lists ids it couldn't match in `unresolved`.
3. For n8n, import `docs/examples/n8n-retailer-offers.json`: a schedule, a placeholder for your deals source, a step that maps rows to observations, and the post. Add a Header Auth credential (`Authorization`, `Bearer <token>`) to the last step.

`GET /api/v1/prices?id=75192&type=offer&days=14` lists what was stored, to check a flow.

Set `APP_URL` to your Brickfolio address so alerts link back to the wishlist. Settings → About this server shows whether alerts are on.

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

**Coolify with Tailscale**: Coolify takes a single compose file, so the repo ships a ready-merged one, `compose.coolify-tailscale.yml`. Create a Git-based Docker Compose resource and set its compose location to `/compose.coolify-tailscale.yml`. It runs the published image `ghcr.io/scoobydrew83/brickfolio:latest`, so deploys only pull and restart; set `BRICKFOLIO_IMAGE` to pin a release (for example `ghcr.io/scoobydrew83/brickfolio:0.2`), or replace `image:` and `pull_policy:` under `app` with `build: .` and `pull_policy: build` to build from source. The file also works pasted into a **Docker Compose Empty** resource. Add `TS_AUTHKEY`, `ALLOWED_USERS` and the four `BRICKLINK_*` values under Environment Variables, plus any optional ones (`REBRICKABLE_API_KEY`, `ALERT_WEBHOOK_URL`, `APP_URL`, `TZ`). To update, redeploy in Coolify: it pulls the newest image. Don't assign a domain in Coolify: the app is only served at `https://brickfolio.<your-tailnet>.ts.net`.

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

```bash
docker compose pull
docker compose up -d
```

Database changes are applied automatically when the app starts. Your data lives in the `data` volume and is kept. The app also backs it up daily to `/data/backups`, so you can roll back. See [Data and backups](../README.md#data-and-backups).

For Cloudflare Workers, pull the latest code and run `npm run cf:deploy` again.

## Troubleshooting

- **"Not signed in. This app only accepts requests through Tailscale or Cloudflare Access."** The request didn't come through the expected proxy. With Tailscale, open the `https://….ts.net` address from a device signed in as a user; a tagged device or the server's own IP won't send the login header. With Cloudflare, check that `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` match the Access application, and that the Access application covers the exact hostname.
- **`manifest unknown` or `not found` when pulling the image.** The tag doesn't exist yet. Set `BRICKFOLIO_IMAGE=ghcr.io/scoobydrew83/brickfolio:main` in `.env`, or build from a clone with `docker compose up -d --build`.
- **`!reset` or `env_file` errors from Compose.** Your Compose is older than v2.24. Update Docker.
- **No prices or photos.** Check the four `BRICKLINK_*` values and that the BrickLink access token was registered for IP `0.0.0.0`. Run **Sync BrickLink** and check `docker compose logs app`.
- **Is it running?** `curl http://127.0.0.1:3000/api/health` returns `{"ok":true}` (local setup). In every setup, `docker compose ps` shows the container as `healthy`.
