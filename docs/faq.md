# FAQ

- [Why are values based on BrickLink sold prices?](#why-are-values-based-on-bricklink-sold-prices)
- [Why no BrickOwl or BrickEconomy prices?](#why-no-brickowl-or-brickeconomy-prices)
- [Do I need BrickLink API keys?](#do-i-need-bricklink-api-keys)
- [What leaves my server?](#what-leaves-my-server)
- [Where can I run it?](#where-can-i-run-it)
- [Is this a LEGO product?](#is-this-a-lego-product)
- [Can Home Assistant show my collection's value?](#can-home-assistant-show-my-collections-value)
- [Can I chart it in Grafana?](#can-i-chart-it-in-grafana)

## Why are values based on BrickLink sold prices?

Brickfolio's aim is to say what your collection is worth today, priced from what sets actually sell for. BrickLink's price guide gives the average, lowest and highest price that each set sold for, separately for new and used, with the number of sales. That is closer to what you would get than an asking price or a list price.

- A set's Est. Value is the average sold price for its condition, less its missing pieces.
- Each set's page shows BrickLink's new and used sold prices side by side, and built and sealed copies are each valued from their own condition.
- Every money figure says where it came from. Other sources (Brickset retail prices, retailer offers your flows post) are listed next to it and never averaged in.
- **Settings → Currency → Value source** picks the one source Est. Value comes from, BrickLink by default. A set with no value from the chosen source shows none.

## Why no BrickOwl or BrickEconomy prices?

- **BrickOwl** isn't possible: Brick Owl doesn't offer its prices to third-party tools, and its API terms forbid AI-generated code (#45).
- **BrickEconomy** is deferred: its API needs a Premium subscription for each user, and its API reference and terms are only visible to Premium members (#46). Brickfolio can use a BrickEconomy key for barcode lookups only, and that lookup is marked unverified: it was written without the reference and hasn't been tested with a real key.

## Do I need BrickLink API keys?

They're optional, but without them there are no prices, photos or parts lists from BrickLink. They're free: see [Get your BrickLink API keys](install.md#get-your-bricklink-api-keys). The API allows 5,000 calls a day, which covers a couple of thousand sets per daily sync.

## What leaves my server?

Brickfolio has no account service and sends no usage data. The server calls these hosts, and only for the features you turn on:

| Host | When | What is sent |
|---|---|---|
| `api.bricklink.com` | With BrickLink keys: lookups, the daily sync, your store and orders | Set, minifigure and part numbers, signed with your keys |
| `img.bricklink.com`, `cdn.rebrickable.com` | Photos for the image cache; Rebrickable's catalog downloads | Requests for photos and files |
| `rebrickable.com` | With `REBRICKABLE_API_KEY` | Set, part and MOC numbers |
| `brickset.com` | With `BRICKSET_API_KEY` | Set numbers |
| `library.ldraw.org` | Downloading the LDraw parts library, and models for sets without one (`LDRAW_OMR_SYNC=off` stops that) | Set numbers |
| `api.github.com` | The daily release check (`UPDATE_CHECK=off` turns it off) | Nothing about your collection |
| `raw.githubusercontent.com` | The community barcode list in the daily sync (`COMMUNITY_LIST=off` turns it off) | Only an unchanged-or-not check |
| `api.comparethebricks.com`, `www.brickeconomy.com` | Only with their keys, for a barcode none of the saved ones knows | The barcode only |
| Your alert channels and email provider | When an alert or sign-in email is sent | The alert's text or the email |
| Your Cloudflare Access team domain | With `AUTH_MODE=cloudflare-access` | A request for Access's signing keys |

With `DATABASE_URL` set to Turso, the database itself lives with Turso. On Cloudflare Workers, the browser loads the OCR model files for **Read the set number** from `cdn.jsdelivr.net`; elsewhere they come from your own server. Barcodes are read on the phone, and no picture leaves it.

Each service is used with your own key and under its own terms.

## Where can I run it?

- **Docker** on any machine with Docker Compose v2.24 or newer, on 64-bit Intel/AMD (`amd64`) or ARM (`arm64`, such as a Raspberry Pi 4 or 5 and most recent NAS boxes). Reach it locally, through Tailscale, or through a Cloudflare Tunnel with Cloudflare Access. See [install.md](install.md).
- **Docker GUIs:** Portainer, Dockge, Synology Container Manager, and Coolify ([coolify.md](coolify.md)).
- **Cloudflare Workers** with D1, on the free plan. See [cloudflare.md](cloudflare.md).
- **Vercel** (with a Turso database), **Railway** and **Render**. See [hosting.md](hosting.md).

## Is this a LEGO product?

No. LEGO® is a trademark of the LEGO Group, which does not sponsor, authorize or endorse this project. Brickfolio uses the BrickLink API but is not endorsed or certified by BrickLink. [NOTICE](../NOTICE) has the trademark notes and data sources.

## Can Home Assistant show my collection's value?

Yes, with a REST sensor reading `GET /api/v1/history`. It answers with one row per day, oldest first:

```json
{ "history": [ { "date": "2026-11-25", "sets": 42, "copies": 51, "estValue": 6120.5, "avgSold": 6480.25, "pieces": 61234 } ] }
```

The last row is today's, saved after each sync. Create an API token in **Settings → API tokens**, put it in Home Assistant's `secrets.yaml` as `brickfolio_auth: "Bearer <your-token>"`, then add to `configuration.yaml`:

```yaml
rest:
  - resource: https://brickfolio.tail1234.ts.net/api/v1/history
    headers:
      Authorization: !secret brickfolio_auth
    scan_interval: 3600
    sensor:
      - name: Brickfolio value
        value_template: "{{ value_json.history[-1].estValue }}"
        unit_of_measurement: "USD"
        state_class: measurement
      - name: Brickfolio sets
        value_template: "{{ value_json.history[-1].sets }}"
        state_class: measurement
```

Use your own address and currency. The values only change after a sync, so checking hourly is plenty. Home Assistant has to reach the server: on Tailscale, it must be on your tailnet; behind Cloudflare Access, add a service token or bypass rule for `/api/v1` (see [api.md](api.md#reaching-the-api-through-tailscale-or-cloudflare-access)). `?collection=<id>` gives one collection's totals.

To send Brickfolio's alerts to Home Assistant, see [alerts.md](alerts.md#home-assistant).

## Can I chart it in Grafana?

Only through the JSON API. Brickfolio has no metrics endpoint (no Prometheus or similar). A Grafana data source that reads JSON over HTTP can chart `GET /api/v1/history` (the daily totals) with an `Authorization: Bearer <your-token>` header, or any other read route in [api.md](api.md). The app's own Sets page already charts the value history.
