# Alerts

Brickfolio can tell you when a wishlist set gets cheap, when its price swings, when a wish is about to retire, when a Designer Program pre-order opens or closes, and when a sync goes wrong. Alerts are off until you set at least one channel.

- [What alerts you](#what-alerts-you)
- [Channels](#channels)
- [More than one channel](#more-than-one-channel)
- [Test it](#test-it)
- [Links back to the app](#links-back-to-the-app)
- [The JSON payload](#the-json-payload)
- [Deal alerts from retailer offers](#deal-alerts-from-retailer-offers)
- [n8n](#n8n)
- [Home Assistant](#home-assistant)

## What alerts you

Most alerts are checked at the end of each sync, after the prices are updated. Each kind sends at most one message per sync, listing every set it applies to.

| Alert | When | Setting |
|---|---|---|
| **Under target** | A wish's BrickLink average sold price, in the wish's condition, is at or under your target. | Set a target on the wish. |
| **Price swing** | A wish's BrickLink average sold price moved this many percent or more, up or down, with or without a target. | `PRICE_SWING_PCT` (default `10`; `0` turns it off) |
| **Retiring** | A wishlist set's Brickset exit date is within this many days. Needs `BRICKSET_API_KEY`. | `RETIRE_ALERT_DAYS` (default `60`; `0` turns it off) |
| **Designer Program** | A watched project's pre-order opens within this many days, or closes within 3 days. | `DESIGNER_ALERT_DAYS` (default `7`; `0` turns it off) |
| **Retailer offer** | An offer your own flow posted is at or under a wish's target. | `OFFER_MAX_AGE_DAYS` (default `3`) |
| **Sync problem** | A sync failed or finished with problems, and again when a sync is clean. | `SYNC_ALERT=off` turns it off |

How each one avoids repeating itself:

- **Under target** alerts once per drop. A set that goes back above target, or loses its price, alerts again the next time it drops.
- **Price swing** measures from the first price Brickfolio sees for a wish, then from the price at its last swing alert. A slow drift alerts once it adds up, and each swing alerts once. The message gives the old and new price, the change and the date it's measured from. Changing your currency starts over. Swings aren't checked after a sync that BrickLink's daily limit or maintenance cut short.
- **Retiring** warns once per wish, and again if its exit date moves out of the window and back.
- **Designer Program** warns once per window: once before the pre-order opens and once before it closes. On the Radar page, the bell on a followed project turns its alerts on or off.
- **Retailer offer** alerts once per offer that goes under target, apart from the BrickLink under-target alert.
- **Sync problem** covers set lookups that failed, a step that reported an error, and an alert that didn't go through. The same problem isn't repeated every night; a different one alerts. The daily-limit and time-limit notes don't count as problems.

## Channels

Set any of these as environment variables (in `.env` for Docker, the Environment Variables tab in Coolify, or `npx wrangler secret put` on Cloudflare).

### Webhook: ntfy, Discord or JSON

`ALERT_WEBHOOK_URL` takes a URL. Brickfolio picks the format from the host:

| Host | Format | What is sent |
|---|---|---|
| `ntfy.sh`, or a host starting with `ntfy.` | ntfy | The message as plain text, with the title in the `Title` header and the link in `Click` |
| `discord.com` (or a subdomain), `discordapp.com` | Discord | `{"content": "**title**\nmessage\nlink"}`, cut to 2,000 characters |
| Anything else | JSON | [The JSON payload](#the-json-payload) |

`ALERT_WEBHOOK_FORMAT=ntfy`, `discord` or `json` overrides the guess, for example for your own ntfy server on another host name.

- **Phone push with [ntfy](https://ntfy.sh):** install the ntfy app, subscribe to a long random topic name, and set `ALERT_WEBHOOK_URL=https://ntfy.sh/<that-topic>` (or your own ntfy server).
- **Discord:** create a webhook in a channel's settings and use its URL.
- **Anything else:** any URL that accepts a JSON POST, such as [n8n](#n8n), [Home Assistant](#home-assistant) or Zapier.

### Email

`ALERT_EMAIL_TO=you@example.com` (comma-separate several). Alerts go through the email provider set up for sign-in mail, so `EMAIL_PROVIDER`, `EMAIL_FROM` and the provider's keys must be set too: see [Optional: email](install.md#optional-email). The subject is the alert's title.

### Telegram

Create a bot with @BotFather and set:

```bash
ALERT_TELEGRAM_BOT_TOKEN=<bot-token>
ALERT_TELEGRAM_CHAT_ID=<chat-id>
```

To find the chat ID, message the bot, then open `https://api.telegram.org/bot<bot-token>/getUpdates`.

### Pushover

```bash
ALERT_PUSHOVER_TOKEN=<application-api-token>
ALERT_PUSHOVER_USER=<user-key>
```

### Gotify

```bash
ALERT_GOTIFY_URL=https://gotify.example
ALERT_GOTIFY_TOKEN=<application-token>
```

Messages are posted to `<ALERT_GOTIFY_URL>/message` with priority 5.

## More than one channel

Set as many as you like: every alert goes to all of them at once. An alert counts as sent when at least one channel takes it.

- **Some channels fail:** the alert counts as sent and isn't repeated. The sync message names each failed channel ("Alert not sent to Telegram: …").
- **Every channel fails:** the alert isn't marked as sent, and the sync message says so ("Wishlist alert not sent: …"). The next sync tries again.

Each channel waits at most 15 seconds for an answer. A broken channel never fails the sync. The meaning of each error is in [troubleshooting.md](troubleshooting.md#alerts).

The read-only demo (`DEMO_MODE=on`) sends no alerts.

## Test it

**Settings → Alerts and sync** lists the channels in use and whether sync problem alerts are on. **Send a test alert** sends "Brickfolio test alert" to every channel and says which ones failed. The same page shows the last ten syncs with their messages.

## Links back to the app

Set `APP_URL` to the address you use, for example `https://brickfolio.tail1234.ts.net`. Alerts then link to the page they're about:

| Alert | Link |
|---|---|
| Under target, price swing | `<APP_URL>/wishlist` (a single retailer offer links to the offer instead) |
| Retiring | `<APP_URL>/radar` |
| Designer Program | `<APP_URL>/radar#designer` |
| Sync problem | `<APP_URL>/settings` (and `<APP_URL>/` when it's working again) |

Without `APP_URL`, alerts have no link.

## The JSON payload

With the JSON format, each alert is one POST with `Content-Type: application/json`:

```json
{
  "title": "Millennium Falcon is under your target",
  "message": "75192 Millennium Falcon: average sold $610.00, your target $650.00",
  "url": "https://brickfolio.example/wishlist",
  "items": [
    { "setNo": "75192", "name": "Millennium Falcon", "avgSold": 610, "target": 650 }
  ]
}
```

- `title` and `message` are plain text; `message` has one line per item.
- `url` is the link described above, or `null`.
- `items` lists the sets the alert is about. Each has `setNo`, `name` and `target` (`0` when there is none), and, depending on the alert:
  - `avgSold`: BrickLink's average sold price.
  - `offer`, `source` (for example `retailer:lego`) and `url`: a retailer offer.
  - `from` and `changePct`: a price swing's starting price and its change in percent (signed, for example `-12.5`).
- Sync problem alerts and the test alert have an empty `items` list.

## Deal alerts from retailer offers

Your own flow (n8n, a script, a spreadsheet) can post offers it finds to `POST /api/v1/prices`. When the lowest recent offer for a wish, in its condition and your currency, is at or under your target, the alert channels get one message naming the retailer and linking to the offer. The check runs right after a post, not only at the next sync. The Wishlist page shows the best offer next to the BrickLink price. Offers count for `OFFER_MAX_AGE_DAYS` (default 3) and never change Est. Value. Brickfolio doesn't scrape stores; feed it only from sources you're allowed to use.

1. Create a token in **Settings → API tokens**.
2. Post a batch (at most 200) with an `Idempotency-Key` header, so a retried run doesn't post twice:

   ```bash
   curl -X POST https://your-host/api/v1/prices -H "Authorization: Bearer <your-token>" -H "Content-Type: application/json" \
     -H "Idempotency-Key: deals-2026-11-06-12" \
     -d '{"observations":[{"id":"75192","source":"retailer:lego","type":"offer","condition":"N","currency":"USD","amount":599.99,"url":"https://www.lego.com/…"}]}'
   ```

   `id` can be a set number (`75192` or `75192-1`) or the box barcode. `source` is `retailer:<name>` or `manual`; the sources the app syncs itself (BrickLink, Brickset and so on) are refused. The answer lists ids it couldn't match in `unresolved`.

`GET /api/v1/prices?id=75192&type=offer&days=14` lists what was stored, to check a flow.

## n8n

n8n can take part both ways:

- **Receive alerts:** add a **Webhook** node (POST), use its production URL as `ALERT_WEBHOOK_URL`, and read `title`, `message`, `url` and `items` from the body (see [The JSON payload](#the-json-payload)). From there, send them anywhere n8n reaches.
- **Post retailer offers:** import [`docs/examples/n8n-retailer-offers.json`](examples/n8n-retailer-offers.json): a schedule, a placeholder for your deals source, a step that maps rows to observations, and the post to `/api/v1/prices`. Add a Header Auth credential (`Authorization`, `Bearer <your-token>`) to the last step.

## Home Assistant

Home Assistant can receive the JSON payload with a webhook trigger. Pick a long random webhook ID, then add an automation:

```yaml
alias: Brickfolio alert
triggers:
  - trigger: webhook
    webhook_id: brickfolio-<long-random-id>
    allowed_methods: [POST]
    local_only: true
actions:
  - action: notify.notify
    data:
      title: "{{ trigger.json.title }}"
      message: "{{ trigger.json.message }}"
```

Set `ALERT_WEBHOOK_URL=http://homeassistant.local:8123/api/webhook/brickfolio-<long-random-id>` (your Home Assistant address). `local_only: true` accepts the call only from your local network; set it to `false` if Brickfolio runs elsewhere, such as Cloudflare Workers. Anyone who knows the webhook ID can trigger it, so keep it secret.

To show Brickfolio's numbers in Home Assistant instead, see the REST sensor in the [FAQ](faq.md#can-home-assistant-show-my-collections-value).
