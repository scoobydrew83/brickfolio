# Troubleshooting

What Brickfolio's messages mean and what to do about them. Text in quotes is the message as the app shows it; `…` stands for the part that changes (a set number, a count, the other service's own words).

- [Where to look](#where-to-look)
- [Installing and signing in](#installing-and-signing-in)
- [BrickLink and the sync](#bricklink-and-the-sync)
- [Rebrickable and Brickset](#rebrickable-and-brickset)
- [Photos and the image cache](#photos-and-the-image-cache)
- [Alerts](#alerts)
- [The REST API](#the-rest-api)

## Where to look

- **Settings → Alerts and sync** lists the last ten syncs with their status and message, the alert channels in use, and **Send a test alert**.
- **The sync button** shows progress while a sync runs. A set whose own lookup failed shows its error on its card.
- **The server log:** `docker compose logs app` (in Coolify or Portainer, the app container's logs; on Cloudflare, `npx wrangler tail` or **Workers & Pages → brickfolio → Logs**). Each sync logs one line with how many sets were looked up, failed and were skipped, then one line per distinct error with up to five of the sets it hit and BrickLink's answer.
- **Is it running?** `curl http://127.0.0.1:3000/api/health` returns `{"ok":true}` (local setup), or `{"ok":false}` with status 503 when the database can't be opened. In every Docker setup, `docker compose ps` shows the container as `healthy`.

A sync message is several of the messages below joined with `;`.

## Installing and signing in

### "Not signed in. This app only accepts requests through Tailscale or Cloudflare Access."

The request didn't come through the expected proxy.

- **Tailscale:** open the `https://….ts.net` address from a device signed in as a user. A tagged device, or the server's own IP, doesn't send the login header.
- **Cloudflare:** check that `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` match the Access application, and that the application covers the exact hostname.

### "CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD must be set for AUTH_MODE=cloudflare-access"

Add both values: see [Docker + Cloudflare Tunnel](install.md#2-put-cloudflare-access-in-front-of-it) or [cloudflare.md](cloudflare.md#4-add-secrets). On a Worker deployed with the button, the app refuses every request until they're set.

### "Unknown AUTH_MODE: …"

`AUTH_MODE` must be `none`, `tailscale`, `cloudflare-access` or `better-auth`.

### "Not signed in." or "You don't have access."

You reached the app but it doesn't know you, or you have no role. "You don't have access." is also what a banned person sees. An admin gives roles in **Settings → People**; see [People and permissions](install.md#people-and-permissions).

### `manifest unknown` or `not found` when pulling the image

The tag doesn't exist. `:latest`, `:X.Y` and `:X.Y.Z` exist only for releases, `:main` for the main branch. Set `BRICKFOLIO_IMAGE=ghcr.io/scoobydrew83/brickfolio:main` in `.env`, or build from a clone with `docker compose up -d --build`.

### `!reset` or `env_file` errors from Compose

Your Compose is older than v2.24. Update Docker.

### A setting seems ignored (Coolify, Portainer, Dockge)

These tools don't always write a `.env` file, so only the variables listed under `environment:` in the compose file reach the app. Check that the variable is there and redeploy. See [coolify.md](coolify.md#environment-variables).

### "This is a read-only demo. Install your own Brickfolio to make changes."

`DEMO_MODE=on` is set. Turn it off for your own collection.

## BrickLink and the sync

### No prices or photos

Check the four `BRICKLINK_*` values and that the BrickLink access token was registered for IP `0.0.0.0`. Run **Sync BrickLink**, then read the sync message and the server log.

### "BrickLink API keys are not set."

One of the four `BRICKLINK_*` variables is missing from the app's environment. Without them, the daily job still runs the Rebrickable and Brickset steps when their keys are set.

### "BrickLink rejected the API keys. Check the four BRICKLINK_* values (…)."

BrickLink answered 401 or 403. A value is wrong or swapped: the consumer key and secret come from the consumer, the token value and secret from the access token. See [Get your BrickLink API keys](install.md#get-your-bricklink-api-keys).

### "BrickLink refused the access token from this server's IP address. …"

The token is registered for a different IP. On BrickLink's API page, register it for IP `0.0.0.0` (mask `0.0.0.0`), or for the server's fixed public address. Cloudflare Workers, Vercel, Railway and Render have no fixed outgoing IP, so they need `0.0.0.0`.

### "BrickLink's daily limit of 5,000 calls is used up. Prices update at the next sync."

The sync stops its set lookups when it sees this, followed by "N of M sets were looked up first." The sets not reached keep their last prices, and the rest of the sync (history, alerts, the other services) still runs. BrickLink allows 5,000 calls a day; the sync plans to leave 500 of them for adding sets during the day. If you see it every day, lower `PARTOUT_DAILY_CALLS` or `OTHER_GUIDE_DAILY_CALLS` (see [Part-out value and BrickLink's daily limit](install.md#part-out-value-and-bricklinks-daily-limit)), or add a Rebrickable key so parts lists cost no BrickLink calls.

### "BrickLink is down for maintenance (…). Prices update at the next sync."

BrickLink's maintenance page answered instead of the API. The sync stops its lookups as for the daily limit. Nothing to fix; the next sync tries again.

### "…: BrickLink answered HTTP … with a page instead of API data (…)" or "with an empty reply"

Something in front of BrickLink's API answered, often a firewall or block page. When the message adds "BrickLink's firewall may be blocking this server's address", try again later or from another network.

### "…: couldn't reach BrickLink (…)."

No answer from BrickLink: no internet access or DNS in the container, or "no answer within 20 seconds". Check the server's network.

### "BrickLink has no set … (…)." or "BrickLink couldn't find that (…)."

BrickLink answered 404 for that number. Check the set number, including the suffix (`10280` and `10280-1` both work; some sets are `-2`).

### "… (HTTP …)"

Any other BrickLink error, with BrickLink's own words. The set's card shows it; **Retry lookup** on the set's card tries again.

### "A sync is already running."

Only one sync runs at a time (`POST /api/v1/sync` answers 409). Wait for it to finish; progress shows on the sync button.

### "Stopped (server restarted?)"

A sync was still marked as running more than 30 minutes after it started, usually because the server restarted or the function was stopped mid-sync. The next sync marks it failed with this message and starts over. Sets looked up before it stopped keep their new prices.

### "Time limit reached; the sets not looked up go first at the next sync."

The sync has a time limit (`SYNC_TIME_LIMIT`, or Vercel's default of 180 seconds) and reached it during the set lookups. With a time limit, sets are looked up oldest first, so the next sync starts with the ones skipped. See [How long a sync can run](hosting.md#how-long-a-sync-can-run).

### "Time limit reached; some optional steps were skipped and run at the next sync."

All sets were looked up, but the time limit passed before the later steps (minifigures, wishlist, store, Rebrickable, Brickset, photos, the new/used guide, part prices). They run at the next sync.

### "N new/used price lookups failed (…)"

The second price guide (the other condition, for the new vs. used comparison) failed for some sets. The message names the first two, for example `10280 used: BrickLink: …`, and the server log has one line per failed lookup with BrickLink's reason.

### "N part price lookups failed", "N wishlist lookups failed", "N minifig lookups failed"

Those lookups failed for some items; they keep their last prices and are tried at the next sync. The wishlist page and the Minifigs page show each item's error. "and N more errors" means more than three step errors were cut from the message.

### The sync message says a step failed, but prices updated

Each step's error is reported on its own and doesn't stop the others. Prices saved before the error are kept.

## Rebrickable and Brickset

**Settings → Rebrickable** and **Settings → Brickset** each have **Test key**, which makes one call and shows what the service said.

### "REBRICKABLE_API_KEY isn't set on the server." or "BRICKSET_API_KEY isn't set on the server."

The variable isn't reaching the container. In Coolify, add it in the Environment Variables tab and redeploy (and check it's in the compose file; see [coolify.md](coolify.md#environment-variables)).

### "Rebrickable: Invalid token."

The Rebrickable key is wrong. Generate one under your Rebrickable profile's **Settings → API**.

### "Couldn't reach rebrickable.com from the server (…). Check the server's internet access and DNS."

The container has no internet access or DNS. The same message exists for brickset.com.

### "Rebrickable doesn't share the parts list of …."

The designer of that build keeps its parts list private or sells it with the instructions. Brickfolio notes the build, skips it, and asks again after 90 days. **What can I build?** lists these builds with a link to each on Rebrickable.

### "Rebrickable has no parts list for …."

Rebrickable answered "not found" for that MOC's parts.

### "Brickset: …" or "Brickset answered …"

Brickset's own answer, for example about the key. "Brickset sent a reply that is not JSON." means something other than Brickset's API answered.

## Photos and the image cache

### "Image cache: EACCES: permission denied, mkdir '/app/data'"

On Coolify installs before 0.21.0 the compose file didn't pass `IMAGE_CACHE_DIR`, so photos went to a folder the app can't write to. Redeploy so Coolify reads the current compose file. Adding `IMAGE_CACHE_DIR` in Coolify's Environment Variables tab alone doesn't help with the old file, which doesn't pass it to the app. See [coolify.md](coolify.md#troubleshooting).

### "Image cache: …"

Any other error from the cache folder or R2 bucket, for example a full disk. The cache can be emptied in **Settings → Image cache**, or set `IMAGE_CACHE=off` to stop keeping photos.

### "Image cache: N photos couldn't be fetched"

The daily sync fetches photos not in the cache yet (`IMAGE_CACHE_WARM`, default 200). Some downloads from BrickLink's or Rebrickable's image servers failed; they're tried again later.

## Alerts

See [alerts.md](alerts.md) for setting them up.

### "No alert channel is set."

**Send a test alert** found no channel: none of `ALERT_WEBHOOK_URL`, `ALERT_EMAIL_TO`, the Telegram, Pushover or Gotify pairs is set, or a URL doesn't start with `http://` or `https://`. Both variables of a pair are needed.

### "Not sent: …" or "Sent, but not to …"

From **Send a test alert**: every channel failed, or some did. Each failure names the channel and its error.

### "Wishlist alert not sent: …", "Price swing alert not sent: …", "Retirement alert not sent: …", "Designer Program alert not sent: …", "Sync alert not sent: …"

Every configured channel failed for that alert. The alert isn't marked as sent, so the next sync tries again.

### "Alert not sent to …: …"

One channel failed while another took the alert. The alert counts as sent, so it isn't repeated; fix the named channel.

### "Alert webhook answered …", "Telegram answered …", "Pushover answered …", "Gotify answered …"

The service refused the message with that HTTP status. Check the URL, token or chat ID.

### "ALERT_EMAIL_TO is set but email isn't (EMAIL_PROVIDER and EMAIL_FROM)"

Email alerts go through the sign-in email provider. Set `EMAIL_PROVIDER`, `EMAIL_FROM` and the provider's keys: see [Optional: email](install.md#optional-email).

### "Email via … failed: …"

The email provider's own error, for example "not set up (…)" with the missing variables, or an address the provider won't send to.

## The REST API

### "Unauthorized. Send Authorization: Bearer <api token>."

No valid token. Create one in **Settings → API tokens** and send it as `Authorization: Bearer <token>` or `x-api-key: <token>`. A revoked or expired token, or one whose owner was deleted or taken out of `ALLOWED_USERS`, gets the same answer.

### "Unauthorized. Send Authorization: Bearer <CRON_SECRET>."

From `GET /api/v1/sync/cron`, which takes only `CRON_SECRET`, not API tokens. Set `CRON_SECRET` on the server and send the same value.

### "Cross-site request blocked. Use an API token for requests from other sites."

A write from a browser on another site, without a token. Send an API token.

### "Send an Idempotency-Key header (any unique string up to 100 characters)."

`POST /api/v1/prices` and `POST /api/v1/barcodes/batch` need one, so a retried request doesn't add twice.

More about the API: [api.md](api.md).
