# Hosting on Vercel, Railway or Render

One-click setups for hosts other than your own server or Cloudflare. Each needs a place to keep the database and a way
to run the daily sync; this page says which, per host.

| Host | Database | Daily sync | Sign-in | Plan |
|---|---|---|---|---|
| [Vercel](#vercel) | libSQL / [Turso](https://turso.tech) (Vercel has no disk) | Vercel Cron → `GET /api/v1/sync/cron` | Better Auth | Hobby works; a sync is cut to about 3 minutes of lookups a day ([why](#how-long-a-sync-can-run)) |
| [Railway](#railway) | SQLite on a volume | The app's own scheduler (always on) | Better Auth | Any plan with volumes |
| [Render](#render), paid | SQLite on a persistent disk | The app's own scheduler (always on) | Better Auth | A paid instance type (disks need one) |
| [Render](#render), free | libSQL / Turso | A Render cron job (or any scheduler) → `GET /api/v1/sync/cron` | Better Auth | Free web service; the cron job is a paid service type |

Prices and limits change: **check each host's current pricing** before you choose. The limits quoted below are from
their documentation as of November 2026, with links.

Everything else (BrickLink keys, Rebrickable, Brickset, email, alerts) is set as environment variables in the host's
dashboard, exactly as in [`.env.example`](../.env.example) and [docs/install.md](install.md#before-you-start).

- [Before you start: sign-in and secrets](#before-you-start-sign-in-and-secrets)
- [A Turso database](#a-turso-database)
- [Vercel](#vercel)
- [Railway](#railway)
- [Render](#render)
- [The cron endpoint](#the-cron-endpoint)
- [How long a sync can run](#how-long-a-sync-can-run)

## Before you start: sign-in and secrets

These hosts put the app on the public internet, so use Brickfolio's own accounts: `AUTH_MODE=better-auth` (see
[Better Auth sign-in](install.md#better-auth-sign-in)). The first account to sign up becomes the admin and sign-up
then closes, so **sign up yourself right after the first deploy**.

| Variable | What to put |
|---|---|
| `AUTH_MODE` | `better-auth` |
| `BETTER_AUTH_SECRET` | A long random string, e.g. `openssl rand -hex 32`. Keep it: changing it signs everyone out. |
| `BETTER_AUTH_URL` | The address people use, e.g. `https://brickfolio.example.com`. Set for you on Render and Railway (below); on Vercel production it defaults to the project's production address. |
| `CRON_SECRET` | A long random string with only letters and digits (`openssl rand -hex 32`). Needed where a cron service starts the sync (Vercel, Render free). |
| `BRICKLINK_*` | Your [BrickLink API keys](install.md#get-your-bricklink-api-keys). Register the access token for IP `0.0.0.0`: these hosts have no fixed outgoing IP. |

Email (password reset, invitations) is optional; see [Optional: email](install.md#optional-email). SMTP works on all
three hosts, as do the HTTP providers (Resend, Postmark, SES).

## A Turso database

Vercel and Render's free plan have no disk that survives a restart, so the database lives in
[Turso](https://turso.tech) (hosted libSQL, SQLite-compatible) instead:

1. Create a database: in the Turso dashboard, or with the CLI: `turso db create brickfolio`.
2. Its URL (`turso db show brickfolio --url`, looks like `libsql://brickfolio-<you>.turso.io`) → `DATABASE_URL`.
3. A token (`turso db tokens create brickfolio`) → `DATABASE_AUTH_TOKEN`.

Brickfolio creates its tables in it (on Vercel during the build, elsewhere when the app first opens it). Backups are
Turso's job (point-in-time restore); the daily copies to `/data/backups` only happen with the SQLite file.
Check [Turso's pricing](https://turso.tech/pricing) for the free tier's storage and row limits: the full Rebrickable
catalog (`REBRICKABLE_CATALOG=full`, about 70 MB) is the biggest thing Brickfolio stores; `owned` keeps it small.

## Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fscoobydrew83%2Fbrickfolio&project-name=brickfolio&repository-name=brickfolio&env=DATABASE_URL,DATABASE_AUTH_TOKEN,AUTH_MODE,BETTER_AUTH_SECRET,CRON_SECRET&envDefaults=%7B%22AUTH_MODE%22%3A%22better-auth%22%7D&envDescription=A%20Turso%20database%20(URL%20and%20token)%2C%20a%20sign-in%20secret%20and%20a%20cron%20secret%20(long%20random%20strings).&envLink=https%3A%2F%2Fgithub.com%2Fscoobydrew83%2Fbrickfolio%2Fblob%2Fmain%2Fdocs%2Fhosting.md%23vercel)

1. [Create a Turso database](#a-turso-database).
2. Click the button. Vercel copies the repo to your Git account and asks for `DATABASE_URL`, `DATABASE_AUTH_TOKEN`,
   `AUTH_MODE` (filled in: `better-auth`), `BETTER_AUTH_SECRET` and `CRON_SECRET`.
3. After the deploy, add your `BRICKLINK_*` keys (and any others) under **Settings → Environment Variables**, then
   **Redeploy**: a deployment keeps the values it was built with.
4. Open the site and sign up: the first account is the admin.

**What `vercel.json` sets up:**

- **Build:** `node scripts/migrate.mjs && next build`. Migrations run against `DATABASE_URL` during the build, not
  when a function starts: Vercel's functions don't carry the `drizzle/` folder, many cold starts at once shouldn't
  race to migrate, and a failed migration fails the deploy while the previous deployment keeps serving. Only
  **Production** builds migrate. A Preview build skips it unless `DB_MIGRATE_ON_BUILD=on`; give Preview its own
  `DATABASE_URL` before turning that on, or a branch's migrations would change your production database.
- **Daily sync:** a cron job calls `GET /api/v1/sync/cron` at `17 4 * * *` (UTC) with `Authorization: Bearer
  $CRON_SECRET`, which Vercel adds itself when `CRON_SECRET` is set
  ([docs](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)). On Hobby, cron jobs may run
  once a day and fire somewhere within the hour you pick
  ([limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)). Change the time in `vercel.json`. Crons run on
  production deployments only.
- **No in-process scheduler and no disk:** `SYNC_HOUR` and `BACKUP_KEEP` don't apply; photos aren't cached on the
  server (`IMAGE_CACHE_DIR=/tmp/images` keeps them per function instance, lost when it's recycled); the LDraw library
  for the 3D view needs `LDRAW_LIBRARY_URL` (there is no folder to download it into).
- **Startup check:** without a libSQL `DATABASE_URL`, the build stops with a message saying so, and a deployment
  that somehow lacks it answers every request with an error naming `DATABASE_URL` in the logs.
- **`BETTER_AUTH_URL`:** when unset on a production deployment, it becomes `https://$VERCEL_PROJECT_PRODUCTION_URL`
  (your shortest production domain, e.g. the custom domain once you add one; needs Vercel's system environment
  variables exposed, the default). Set it yourself if you use another address. Preview deployments get no default,
  so Better Auth uses the request's address.

**Runtime:** Node.js functions (the default; Brickfolio's server code needs Node, not the Edge runtime).

## Railway

Railway runs the Docker image as an always-on service with a volume, so it works like the Docker setup: SQLite in
`/data`, daily backups, the photo cache, and the app's own scheduler for the daily sync (`SYNC_HOUR`, `TZ`). **No
cron service is needed.**

`railway.json` in the repo sets the build (the `Dockerfile`), the health check (`/api/health`), restarts on failure,
one replica, and `requiredMountPath: /data` so a deploy without the volume fails instead of losing your data on the
next restart ([config reference](https://docs.railway.com/reference/config-as-code)).

### Deploy from the repo

1. **New Project → Deploy from GitHub repo** → your copy of Brickfolio.
2. Right-click the service → **Attach Volume**, mount path **`/data`**.
3. **Variables:** `AUTH_MODE=better-auth`, `BETTER_AUTH_SECRET` (random), `BETTER_AUTH_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}`
   (a [reference variable](https://docs.railway.com/guides/variables#referencing-variables-in-the-same-service) to the service's own generated domain), your `BRICKLINK_*`
   keys, and **`RAILWAY_RUN_UID=0`**. The image runs as an unprivileged user, and Railway mounts volumes owned by
   root; `RAILWAY_RUN_UID=0` is Railway's documented fix ([volumes](https://docs.railway.com/reference/volumes)).
4. **Settings → Networking → Generate Domain**, then open it and sign up.

### A template (one-click button)

A Railway template can't be defined by a file in the repo: it's made in the dashboard
([guide](https://docs.railway.com/guides/create)). To publish one: **Workspace settings → Templates → New
Template**, add a service from this GitHub repo, attach a volume at `/data`, and set the variables above, using
`${{secret(32)}}` for `BETTER_AUTH_SECRET` and leaving the `BRICKLINK_*` ones for the user to fill in. **Create
Template** gives a link like `https://railway.com/new/template/<code>`; the button is
([publish and share](https://docs.railway.com/guides/publish-and-share))

```markdown
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/<code>?utm_medium=integration&utm_source=button&utm_campaign=brickfolio)
```

Volumes and plan limits: one volume per service, a short downtime on each redeploy, no replicas; volume size depends
on the plan (see [volumes](https://docs.railway.com/reference/volumes)). To use Turso instead of a volume, set
`DATABASE_URL`/`DATABASE_AUTH_TOKEN` and remove `requiredMountPath` from `railway.json`.

## Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/scoobydrew83/brickfolio)

Two Blueprints ([spec](https://render.com/docs/blueprint-spec)):

### Option A: persistent disk (`render.yaml`, the button)

A web service from the `Dockerfile` with a 1 GB disk at `/data` (SQLite, backups, photos, LDraw library). Disks need
a paid instance type ([free plan limits](https://render.com/docs/free)); the Blueprint uses the smallest,
`0.5c-512mb`. The service never sleeps, so the app's own scheduler runs the sync: **no cron job needed**.
`BETTER_AUTH_SECRET` is generated, `BETTER_AUTH_URL` is the service's own `RENDER_EXTERNAL_URL`, and Render asks for
the `BRICKLINK_*` keys. A disk prevents zero-downtime deploys (a few seconds offline per deploy) and scaling past one
instance ([disks](https://render.com/docs/disks)).

If the log says the database can't be opened (permission denied on `/data`), the disk isn't writable by the image's
unprivileged user (this setup hasn't been tried on a real Render account yet). Use option B, or open an issue.

### Option B: free instance + Turso (`deploy/render-turso.yaml`)

The free instance type has no disk and spins down after 15 minutes without requests
([free plan](https://render.com/docs/free)), so the database is in [Turso](#a-turso-database) and a cron job starts
the sync. In the Render Dashboard: **New → Blueprint** → your copy of the repo → **Blueprint path**
`deploy/render-turso.yaml`. Render asks for `DATABASE_URL`, `DATABASE_AUTH_TOKEN` and the `BRICKLINK_*` keys, and
generates `BETTER_AUTH_SECRET` and `CRON_SECRET`.

The cron job (`brickfolio-daily-sync`, `17 4 * * *` UTC) runs `node scripts/cron-trigger.mjs --wait`: it calls
`GET /api/v1/sync/cron` (retrying while the sleeping service starts), then checks the sync's progress once a minute
until it finishes (without BrickLink keys it follows the Rebrickable and Brickset run instead, `catalogOnly` in
`GET /api/v1/sync`). Those requests keep the free service awake for the whole sync, and the result is in the job's
logs. Cron jobs are their own paid service type, billed for the time they run with a monthly minimum
([cron jobs](https://render.com/docs/cronjobs)); to stay entirely free, delete the cron job and call the
[cron endpoint](#the-cron-endpoint) from any free external scheduler instead (a sync longer than 15 minutes may then
be cut off when the service spins down; set `SYNC_TIME_LIMIT=780` to stop it cleanly first).

Copies made with the button don't redeploy on pushes to this repo (`autoDeployTrigger: off`); deploy updates from the
service's **Manual Deploy** menu.

## The cron endpoint

`GET /api/v1/sync/cron` with `Authorization: Bearer <CRON_SECRET>` starts the same full sync as `POST /api/v1/sync`,
in the background:

| Answer | Meaning |
|---|---|
| `202 {"runId": …}` | Started. |
| `202 {"started": …}` | No BrickLink keys: the Rebrickable and Brickset steps started (once a day). |
| `200 {"skipped": …}` | A sync already started today (cron services can deliver a run twice). |
| `409` | A sync is running. |
| `400` | No BrickLink, Rebrickable or Brickset keys are set, so there's nothing to sync. |
| `401` | No `CRON_SECRET` on the server, or the header doesn't match. API tokens and browser sessions aren't accepted here. |

Any scheduler can use it, e.g. a crontab line on another machine:

```bash
17 4 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://bricks.example/api/v1/sync/cron
```

or `BRICKFOLIO_URL=https://bricks.example CRON_SECRET=… node scripts/cron-trigger.mjs --wait` (Node 18+, no
install). `GET /api/v1/sync` (the status) and `POST /api/v1/sync` are unchanged.

## How long a sync can run

The sync looks up every set at BrickLink (about one second each), then the wishlist, minifigures, store, catalog
downloads and part prices. On Docker, Railway and Render it takes as long as it needs.

On **Vercel** it runs after the cron request is answered, inside that function, which Vercel stops after its maximum
duration: 300 seconds on Hobby, up to 800 on Pro ([duration limits](https://vercel.com/docs/functions/configuring-functions/duration)).
The sync routes set `maxDuration = 300`, and the sync stops *starting* new work 2 minutes before that
(`SYNC_TIME_LIMIT`, default 180 seconds on Vercel):

- With a time limit, sets are looked up **oldest first** (by when they were last looked up), so the sets a short sync
  didn't reach go first the next day. About 180 sets fit in one day; a collection of 500 is fully refreshed every
  three days or so.
- When the limit passes, the remaining set lookups, minifigures, wishlist, store, Rebrickable/Brickset steps, photos,
  the new/used guide and part prices are skipped; today's history and the alerts are still saved, and the run ends as
  done with "Time limit reached …" in its message.
- If the function is stopped anyway (a slow step after the limit), every set already looked up keeps its new price
  (each is saved on its own), and the run stays "running" until the next sync, more than 30 minutes later, marks it
  failed and starts over. Nothing is left half-written beyond that run's own record and today's history row.

On Pro you can give it longer: in your copy, change `maxDuration` to `800` in `app/api/v1/sync/cron/route.ts` (and
`app/api/v1/sync/route.ts` for **Sync now**), and set `SYNC_TIME_LIMIT=680`. `SYNC_TIME_LIMIT` (seconds, `off` for
none) works on any host.
