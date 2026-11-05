# Deploy to Cloudflare Workers + D1

Brickfolio runs on Cloudflare's free plan: the Next.js app is a Worker (via the [OpenNext adapter](https://opennext.js.org/cloudflare)), data lives in D1 (SQLite), and a Cron Trigger runs the daily BrickLink sync. Cloudflare Access puts a login in front of it. There's no server to look after.

## One-click deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/scoobydrew83/brickfolio)

The button does steps 1, 2, 4 and 5 below for you:
1. It copies the repo to your GitHub account.
2. It creates the D1 database.
3. It asks for the secrets, each with a short explanation.
4. It deploys with Workers Builds, and redeploys on every push to your copy.

Before you start:
- Register your [BrickLink API keys](install.md#get-your-bricklink-api-keys) for IP `0.0.0.0`.
- You can leave `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` empty for now.

On the setup page, keep the suggested **build command** (`npm run build`) and **deploy command** (`npm run deploy`). The deploy command builds the Worker, applies the database migrations, then deploys.

Then, once it's deployed:
1. Do [step 3](#3-choose-the-address-and-protect-it-with-cloudflare-access) to put Cloudflare Access in front of the Worker.
2. Add the two Access values under **Workers & Pages → brickfolio → Settings → Variables and Secrets**.

Until then, the app refuses every request (`AUTH_MODE=cloudflare-access`), so nobody else can use it in the meantime.

To update later, pull new releases into your copy of the repo; each push redeploys.

## What you need

- A Cloudflare account (free plan is enough).
- **Node.js 22** and **git** on your computer. You deploy from your computer, or later from GitHub (see [Deploy from GitHub](#optional-deploy-from-github-on-every-push)).
- Your [BrickLink API keys](install.md#get-your-bricklink-api-keys), with the access token registered for IP `0.0.0.0`: Workers have no fixed outbound IP.

## Files involved

| File | What it's for | Do you edit it? |
|---|---|---|
| `wrangler.jsonc` | Worker name, D1 database, daily sync time, plain settings | Yes: add your `database_id` (step 2). Optionally change `name`, `TZ` and the cron |
| `cloudflare/worker.ts` | Worker entry: the app plus the daily sync trigger | No |
| `open-next.config.ts` | OpenNext build settings | No |
| `drizzle/` | Database migrations, applied by `npm run cf:deploy` | No |
| `.dev.vars` | Settings for local preview only (copy of `.dev.vars.example`) | Only for `npm run cf:preview` |

Secrets (BrickLink keys, Access settings) are **not** stored in files. You add them with `wrangler secret put` in step 4.

## 1. Get the code

Fork the repo on GitHub if you want to deploy from GitHub later, then:

```bash
git clone https://github.com/<you>/brickfolio.git
cd brickfolio
npm ci
npx wrangler login     # opens a browser to authorize Wrangler
```

## 2. Create the database

```bash
npx wrangler d1 create brickfolio
```

It prints a block like this:

```jsonc
{
  "d1_databases": [
    { "binding": "DB", "database_name": "brickfolio", "database_id": "0a1b2c3d-..." }
  ]
}
```

Add the `database_id` to the `DB` entry in `wrangler.jsonc`, as `"database_id": "0a1b2c3d-..."`. Keep `"binding": "DB"`; the app looks for that name. The ID isn't secret, so it's fine to commit it to your fork.

## 3. Choose the address and protect it with Cloudflare Access

The Worker is served at `https://brickfolio.<your-subdomain>.workers.dev` (the `name` in `wrangler.jsonc`, plus your account's workers.dev subdomain). To use your own domain instead, add it after the first deploy under **Workers & Pages → brickfolio → Settings → Domains & Routes → Add → Custom domain**. The domain's DNS must be on Cloudflare.

Then add Access in front of whichever address you use:

1. In the Cloudflare dashboard go to **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Enter the hostname you'll use (`brickfolio.<sub>.workers.dev` or your custom domain).
3. Add a policy: **Action** Allow, **Include** Emails, and your email address(es).
4. Save, then copy the application's **Application Audience (AUD) Tag**. Note your team domain, `<team-name>.cloudflareaccess.com` (the team name is under **Zero Trust → Settings**).

The app checks Access's signed JWT on every request (`AUTH_MODE=cloudflare-access`, already set in `wrangler.jsonc`). Requests that skip Access get a 401.

## 4. Add secrets

Run each command and paste the value when asked. If Wrangler says the Worker doesn't exist yet, answer yes to create it.

```bash
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN   # e.g. myteam.cloudflareaccess.com
npx wrangler secret put CF_ACCESS_AUD           # the AUD tag from step 3
npx wrangler secret put CRON_SECRET             # any long random string, e.g. from: openssl rand -hex 32
npx wrangler secret put BRICKLINK_CONSUMER_KEY
npx wrangler secret put BRICKLINK_CONSUMER_SECRET
npx wrangler secret put BRICKLINK_TOKEN         # BrickLink's "Token Value"
npx wrangler secret put BRICKLINK_TOKEN_SECRET
npx wrangler secret put REBRICKABLE_API_KEY    # optional: themes and minifig counts
npx wrangler secret put ALERT_WEBHOOK_URL      # optional: wishlist alerts (ntfy, Discord or JSON webhook)
npx wrangler secret put COMPARETHEBRICKS_API_KEY  # optional: barcode lookups for the scanner
```

Optional: `ALLOWED_USERS` (comma-separated emails) as a second check on top of the Access policy.

## 5. Deploy

```bash
npm run cf:deploy   # builds, applies D1 migrations, deploys
```

Open the address from step 3 and sign in through Access. To bring over data, use **Settings → Import** with CSV files.

Run `npm run cf:deploy` again whenever you pull new code. It applies any new migrations first.

## Optional: deploy from GitHub on every push

Cloudflare can build and deploy your fork itself (Workers Builds). Do steps 1–5 once first, commit the `database_id` change in `wrangler.jsonc`, and push it to your fork. Then:

1. Open **Workers & Pages → brickfolio → Settings → Build** and connect your GitHub fork.
2. Set:

   | Setting | Value |
   |---|---|
   | Branch | `main` |
   | Build command | `npx opennextjs-cloudflare build` |
   | Deploy command | `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy` |
   | Root directory | `/` (leave empty) |
   | Build variable | `NODE_VERSION` = `22` |

The Worker name in the dashboard must match `name` in `wrangler.jsonc`. Secrets stay as you set them in step 4.

## Notes

- **Share links:** to let people without Access open a share link, add Access applications for the same hostname with paths `share` and `_next/static`, each with a **Bypass / Everyone** policy. See [Share a read-only link](install.md#share-a-read-only-link).

- **Sync schedule:** `triggers.crons` in `wrangler.jsonc`, in UTC (default `17 4 * * *`, 04:17 UTC). The cron calls `POST /api/v1/sync` with `CRON_SECRET`. `TZ` in `vars` sets the time zone for history dates.
- **Images:** set photos in the app are resized by the Cloudflare Images binding (`IMAGES`). The free plan includes a monthly allowance of transformations. Share pages and offline scanning serve photos from a cache instead: create a bucket with `npx wrangler r2 bucket create brickfolio-images` and uncomment the `r2_buckets` block in `wrangler.jsonc` (binding `IMAGE_CACHE`). Without it, photos are passed through from BrickLink and not kept. **Settings → Image cache** shows how many are stored.
- **Backups:** D1 has Time Travel (point-in-time restore for 30 days). For a file copy: `npx wrangler d1 export brickfolio --remote --output backup.sql`.
- **Local preview:** `cp .dev.vars.example .dev.vars`, add your BrickLink keys, then `npm run cf:preview`. It uses a local D1 and the real Workers runtime, with no login (the script passes `AUTH_MODE=none`).
- **Large collections:** a sync runs inside one Cron invocation (up to 15 minutes of wall time). At about 1 second per set, that covers several hundred sets.
- **Logs:** `npx wrangler tail` streams live logs, or see **Workers & Pages → brickfolio → Logs**.
