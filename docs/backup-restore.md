# Back up and restore

Where your data lives depends on the database:

| Setup | Database | Backups |
|---|---|---|
| Docker (local, Tailscale, Cloudflare Tunnel, Coolify, Portainer…), Railway, Render with a disk | A SQLite file, `/data/app.db` | Brickfolio copies it daily to `/data/backups` |
| Cloudflare Workers | D1 | D1 Time Travel, or `wrangler d1 export` |
| Vercel, Render free, any `DATABASE_URL=libsql://…` | libSQL / Turso | Turso's point-in-time restore |

**Settings → Download all sets as CSV** gives a portable export at any time, whatever the database. It holds your sets, not everything (no wishlist, history, settings or tokens), so it's no substitute for a database backup.

- [Docker and other SQLite setups](#docker-and-other-sqlite-setups)
- [Cloudflare D1](#cloudflare-d1)
- [Turso and libSQL](#turso-and-libsql)
- [Test a restore](#test-a-restore)
- [Off-site copies](#off-site-copies)

## Docker and other SQLite setups

### Daily backups

The app copies the database once a day to `backups/` next to it: `/data/backups` in the Docker image. The first check runs about 30 seconds after the app starts, then every 10 minutes, and a copy is made when there's none for today. Files are named `app-YYYY-MM-DD.db`. The copy uses SQLite's backup API, so it is consistent while the app keeps running.

`BACKUP_KEEP` sets how many daily copies to keep (default `7`). After each new copy, the oldest ones beyond that number are deleted. `BACKUP_KEEP=0` turns the backups off. `BACKUP_DIR` puts them in another folder.

There are no daily copies with libSQL (`DATABASE_URL`), on Vercel, or with `SCHEDULER=off`.

To see them:

```bash
docker compose exec app ls -l /data/backups
```

### A copy by hand

Do this before every upgrade. Copy the newest daily backup out of the volume while the app runs:

```bash
mkdir -p brickfolio-backups
docker compose cp app:/data/backups/. ./brickfolio-backups
```

Or take a copy of the live file with the app stopped, so nothing is half-written:

```bash
docker compose stop app
docker cp "$(docker compose ps -aq app)":/data/app.db ./app-before-upgrade.db
docker compose start app
```

### Restore

1. Stop the app:

   ```bash
   docker compose stop app
   ```

2. Copy the backup over `app.db`, and remove the `-wal` and `-shm` files next to it if they are there (the database runs in WAL mode; those files belong to the old database). This runs a throwaway container with the same volume:

   ```bash
   docker compose run --rm --no-deps --entrypoint sh app -c \
     'cp /data/backups/app-2026-11-20.db /data/app.db && rm -f /data/app.db-wal /data/app.db-shm'
   ```

   To restore a file from your computer instead, copy it into the backups folder first with `docker compose cp ./app-before-upgrade.db app:/data/backups/` while the app runs, then stop it and use that name.

3. Start the app:

   ```bash
   docker compose up -d
   ```

If the backup came from an older Brickfolio version, the app brings it up to date when it opens it. To go back to an older version as well, see [Roll back](upgrading.md#roll-back).

In Coolify, Portainer and similar tools, stop the stack in the tool and run the same commands on the server with `docker compose -p <project>` or plain `docker`, using the tool's container and volume names.

## Cloudflare D1

D1 has Time Travel: point-in-time restore for the last 30 days. See Cloudflare's [Time Travel documentation](https://developers.cloudflare.com/d1/reference/time-travel/) for how to restore.

For a file copy you keep yourself:

```bash
npx wrangler d1 export brickfolio --remote --output backup.sql
```

`brickfolio` is the database name from `npx wrangler d1 create`. Take one before you deploy a release with migrations.

## Turso and libSQL

Backups are Turso's job: it keeps point-in-time history. Check [Turso's documentation](https://docs.turso.tech) and your plan for how far back it goes and how to restore. Brickfolio makes no daily copies for a libSQL database.

## Test a restore

A backup you have never opened is a guess. Open a copy in a second, throwaway Brickfolio that can't sync or send alerts.

**From a clone of the repo** (Node.js 22):

```bash
mkdir -p restore-test && cp brickfolio-backups/app-2026-11-20.db restore-test/app.db
npm ci
DATABASE_PATH=./restore-test/app.db SCHEDULER=off AUTH_MODE=none npm run dev
```

Open <http://localhost:3000>. `SCHEDULER=off` stops the daily sync and backup jobs. Leave your BrickLink keys and alert settings out of `.env.local` for the test, so a click on **Sync** can't spend API calls or send messages.

**With Docker:**

```bash
mkdir -p restore-test && cp brickfolio-backups/app-2026-11-20.db restore-test/app.db
docker run --rm -p 127.0.0.1:3001:3000 --user "$(id -u):$(id -g)" \
  -e AUTH_MODE=none -e SCHEDULER=off -v "$PWD/restore-test:/data" \
  ghcr.io/scoobydrew83/brickfolio:latest
```

Open <http://127.0.0.1:3001>. `--user` runs the container as you, so it can write to the folder. Use the same image tag as the install the backup came from, or a newer one.

Check that your sets, history and wishlist are there, then delete `restore-test`. Opening the copy applies any newer migrations to it, so don't copy it back over your real database.

## Off-site copies

The daily copies sit in the same volume as the database, so they don't survive losing the disk. Copy the backups folder somewhere else on a schedule, for example a crontab line on the server:

```bash
15 5 * * * cd /path/to/brickfolio && mkdir -p brickfolio-backups && docker compose cp app:/data/backups/. ./brickfolio-backups && rsync -a ./brickfolio-backups/ backup-host:brickfolio/
```

Any tool that copies files works: rsync, rclone, restic, your NAS's own backup.

**Not built in:** [Litestream](https://litestream.io) can stream a SQLite file to S3-compatible storage as it changes, run as a sidecar container that mounts the same `data` volume. Brickfolio doesn't ship a Litestream configuration and hasn't been tested with it. If you try it, keep the daily backups too.
