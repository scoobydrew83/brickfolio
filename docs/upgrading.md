# Upgrading

How to move to a newer Brickfolio release, on each kind of setup, and how to go back.

- [Before you upgrade](#before-you-upgrade)
- [Is there a new release?](#is-there-a-new-release)
- [Docker Compose](#docker-compose)
- [Coolify](#coolify)
- [Portainer, Dockge and other Docker GUIs](#portainer-dockge-and-other-docker-guis)
- [Cloudflare Workers](#cloudflare-workers)
- [Vercel, Railway and Render](#vercel-railway-and-render)
- [Pinning a version](#pinning-a-version)
- [How database changes are applied](#how-database-changes-are-applied)
- [Roll back](#roll-back)

## Before you upgrade

1. **Back up your database.** See [backup-restore.md](backup-restore.md). On Docker, copy the newest file in `/data/backups` somewhere safe; on Cloudflare, run `npx wrangler d1 export brickfolio --remote --output backup.sql`.
2. **Read the release's notes in the [CHANGELOG](../CHANGELOG.md).** Recent releases start with a note on what to do first: which database migrations it has (or that it has none), new settings, and anything a particular setup needs (for example "Coolify users: redeploy").
3. If you're several releases behind, read every release in between.

## Is there a new release?

**Settings → About this server** shows the version you're running and, once a day, checks GitHub for a newer release; a dot on the Settings tab means one is out. Only GitHub's public releases list is fetched, and nothing about your collection is sent. `UPDATE_CHECK=off` turns the check off. `GET /api/v1/version` gives the same answer to scripts.

## Docker Compose

In the folder with your compose files and `.env`:

```bash
docker compose pull
docker compose up -d
```

Your data lives in the `data` volume and is kept. If you build from source instead of using the published image, pull the new code and run `docker compose up -d --build`.

## Coolify

Redeploy the resource. The Coolify compose file uses `pull_policy: always`, so a redeploy pulls the image again. A Git-based resource reads the current `compose.coolify-tailscale.yml` from the repository; with a Docker Compose Empty resource, paste the new file first when a release changes it. See [coolify.md](coolify.md#redeploying-and-updating).

## Portainer, Dockge and other Docker GUIs

Redeploy the stack and have the tool pull the image again: with a tag like `:latest`, the newest release only arrives when the image is pulled. In Portainer, a stack created from the repository can also redeploy when the repository changes (**GitOps updates**, see [Portainer, Dockge, Synology and other Docker GUIs](install.md#portainer-dockge-synology-and-other-docker-guis)).

If you pasted a merged compose file into the tool, compare it with the new release's `docker-compose.yml` and overlay, and merge again when they changed.

## Cloudflare Workers

- **Set up with the Deploy to Cloudflare button:** open your copy of the repo on GitHub and click **Sync fork**. Workers Builds deploys it, and its deploy command (`npm run deploy`) applies the database migrations first.
- **Deployed from the command line:** pull the latest code and run:

  ```bash
  npm ci
  npm run cf:deploy   # builds, applies D1 migrations, deploys
  ```

- **Workers Builds from your fork, set up by hand:** push the new code to the branch it watches. Its deploy command, `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`, applies migrations first.

See [cloudflare.md](cloudflare.md).

## Vercel, Railway and Render

Each deploys from your copy of the repository, so bring the new release into it first (on GitHub, **Sync fork** on a fork).

- **Vercel:** a Production build runs the migrations against `DATABASE_URL` before `next build`. A failed migration fails the deploy, and the previous deployment keeps serving. Preview builds don't migrate unless `DB_MIGRATE_ON_BUILD=on`.
- **Railway:** redeploy the service. The app applies migrations when it opens the database.
- **Render:** copies made with the button don't redeploy on pushes (`autoDeployTrigger: off`); deploy the update from the service's **Manual Deploy** menu. The app applies migrations when it opens the database.

See [hosting.md](hosting.md).

## Pinning a version

The Docker setups run `ghcr.io/scoobydrew83/brickfolio:latest` unless `BRICKFOLIO_IMAGE` says otherwise. The tags:

| Tag | Follows |
|---|---|
| `:latest` | The newest release. Moves only when a release is published. |
| `:X.Y`, for example `:0.21` | The newest `0.21.x` release |
| `:X.Y.Z`, for example `:0.21.0` | Exactly that release |
| `:main` | Every change merged to the main branch, before it's released |

To stay on a release until you choose to move, set it in `.env` (or the tool's environment screen):

```bash
BRICKFOLIO_IMAGE=ghcr.io/scoobydrew83/brickfolio:0.21.0
```

To upgrade, change the tag, then pull and start as above.

## How database changes are applied

Database changes are migrations in the `drizzle/` folder, applied in order and recorded in the database, so each runs once.

| Database | When migrations run |
|---|---|
| SQLite file (Docker, Railway, Render with a disk, `npm run dev`) | When the app first opens the database after starting |
| libSQL / Turso | When the app first opens the database, unless `DB_MIGRATE=off`; on Vercel during the Production build instead |
| Cloudflare D1 | During the deploy, by `wrangler d1 migrations apply` |

Migrations only add: new tables, indexes, columns and rows. Releases rarely drop something: migration 0020 dropped a table and 0025 dropped four `sets` columns that newer versions no longer used. The CHANGELOG names every migration in the release that brings it.

## Roll back

To go back to the version you had:

1. Stop the app.
2. **Restore the backup you took before the upgrade.** See [Restore](backup-restore.md#restore), or D1 Time Travel on Cloudflare.
3. **Go back to the old image:** set `BRICKFOLIO_IMAGE` to the release you ran before, for example `ghcr.io/scoobydrew83/brickfolio:0.20.0`, then `docker compose pull` and `docker compose up -d`. On Cloudflare, Vercel, Railway and Render, deploy the old release's code.

Do both. Running the old image against the upgraded database isn't supported: the older code doesn't know about the new tables and columns, and where a release dropped a column, the older code still expects it. Anything you changed after the upgrade is lost with the restore, so roll back soon or note what you changed.
