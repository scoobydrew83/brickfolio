# Run Brickfolio on Coolify

Coolify takes a single compose file, so the repo ships one made for it: `compose.coolify-tailscale.yml`. It is `docker-compose.yml` and `compose.tailscale.yml` merged into one file. The app gets a private HTTPS address on your tailnet, e.g. `https://brickfolio.tail1234.ts.net`, and nothing is published to the internet.

- [Before you start](#before-you-start)
- [Create the resource](#create-the-resource)
- [Environment variables](#environment-variables)
- [Volumes](#volumes)
- [Image tags and pinning a version](#image-tags-and-pinning-a-version)
- [Redeploying and updating](#redeploying-and-updating)
- [Logs](#logs)
- [The LDraw parts library](#the-ldraw-parts-library)
- [Address and domain](#address-and-domain)
- [Troubleshooting](#troubleshooting)

## Before you start

You need:

- A Coolify server with Docker.
- A Tailscale account, with the tag owner, MagicDNS, HTTPS certificates and a tagged auth key set up as in [Docker + Tailscale, step 1](install.md#1-prepare-your-tailnet).
- Your [BrickLink API keys](install.md#get-your-bricklink-api-keys) (optional, but without them there are no prices, photos or parts lists).

## Create the resource

Pick one:

- **Git-based Docker Compose resource.** Point it at `https://github.com/scoobydrew83/brickfolio` (or your fork), branch `main`, and set the compose location to `/compose.coolify-tailscale.yml`. Coolify reads the file from the repository on each deploy.
- **Docker Compose Empty.** Paste the contents of `compose.coolify-tailscale.yml` into it. Coolify then uses your pasted copy, so after an update that changes the file you paste the new version yourself.

The file runs the published image `ghcr.io/scoobydrew83/brickfolio:latest` with `pull_policy: always`, so a deploy pulls and restarts; nothing is built on the server. To build from source instead, replace `image:` and `pull_policy:` under `app` with `build: .` and `pull_policy: build`.

## Environment variables

Add these in the resource's **Environment Variables** tab:

| Variable | What to put |
|---|---|
| `TS_AUTHKEY` | The Tailscale auth key (`tskey-auth-…`). Only used the first time the container signs in. |
| `ALLOWED_USERS` | Your Tailscale login(s), comma-separated. Empty lets anyone on the tailnet in. |
| `BRICKLINK_CONSUMER_KEY`, `BRICKLINK_CONSUMER_SECRET`, `BRICKLINK_TOKEN`, `BRICKLINK_TOKEN_SECRET` | Your BrickLink API keys. |

Optional ones: `ADMIN_USERS`, `REBRICKABLE_API_KEY`, `BRICKSET_API_KEY`, an alert channel (see [alerts.md](alerts.md)), `APP_URL`, `TZ`, `SYNC_HOUR`, `BACKUP_KEEP`, `TS_HOSTNAME`. Each is explained in [`.env.example`](../.env.example).

**Coolify passes only the variables listed under `environment:` in `compose.coolify-tailscale.yml`.** There is no `.env` file in Coolify, so a variable you set in the tab but that the file doesn't list never reaches the app. If a setting seems ignored, check that its name is under `environment:` in the file. For a variable the file doesn't list (for example `COMPARETHEBRICKS_API_KEY` or `REBRICKABLE_CATALOG`), add a line `- NAME` to that list: in your pasted copy for a Docker Compose Empty resource, or in your own fork for a Git-based one.

The repository keeps this list complete for the settings in `docker-compose.yml` and `compose.tailscale.yml`: `lib/compose-files.test.ts` fails when the Coolify file is missing a variable those two files pass (the Cloudflare Access settings excepted, since this file always signs in with Tailscale).

After changing a variable, redeploy so the container starts with it.

## Volumes

The file declares three named volumes. Coolify keeps them across redeploys.

| Volume | Mounted at | Holds |
|---|---|---|
| `data` | `/data` in the app | The database (`/data/app.db`), daily backups (`/data/backups`), cached photos (`/data/images`) and the LDraw library (`/data/ldraw`) |
| `image-cache` | `/app/.next/cache/images` in the app | Resized BrickLink photos |
| `tailscale-state` | `/var/lib/tailscale` in the Tailscale container | The node's identity, so it keeps its address and doesn't need the auth key again |

Deleting `data` deletes your collection. Back it up first: see [backup-restore.md](backup-restore.md).

## Image tags and pinning a version

The image is built by `.github/workflows/docker.yml` in the public repository:

| Event | Tags built |
|---|---|
| A push to `main` | `:main` |
| A release tag `vX.Y.Z` | `:X.Y.Z`, `:X.Y` and `:latest` |

So `:latest`, the default, moves only when a release is published. `:main` follows every change merged to `main`.

To choose a tag, set `BRICKFOLIO_IMAGE` in the Environment Variables tab, for example:

```bash
BRICKFOLIO_IMAGE=ghcr.io/scoobydrew83/brickfolio:0.21.0   # stays on this release
BRICKFOLIO_IMAGE=ghcr.io/scoobydrew83/brickfolio:0.21     # takes 0.21.x fixes
BRICKFOLIO_IMAGE=ghcr.io/scoobydrew83/brickfolio:main     # follows main
```

## Redeploying and updating

Redeploy the resource in Coolify. With the default `:latest` it pulls the newest release and restarts the app. Database changes are applied when the app opens the database. Your data in the `data` volume is kept.

Before an update, back up your database and read the release's notes in the [CHANGELOG](../CHANGELOG.md). Some releases ask Coolify users to redeploy so Coolify reads an updated compose file. See [upgrading.md](upgrading.md) for the full steps and how to go back.

**Settings → About this server** shows the version you run and whether a newer release is out.

## Logs

Open the app container's logs in Coolify. Each sync logs one line with how many sets were looked up, then one line per distinct error with a few of the sets it hit. The Tailscale container's logs show whether it signed in.

**Settings → Alerts and sync** shows the last ten syncs and their messages. [troubleshooting.md](troubleshooting.md) explains each message.

## The LDraw parts library

The 3D view needs the LDraw parts library. The Coolify file sets `LDRAW_LIBRARY_DIR=/data/ldraw`, in the data volume. Open **Settings → 3D models** and click **Download the LDraw library** (about 90 MB; it unzips in the background).

You can also run the download inside the app container with Coolify's command execution:

```bash
node scripts/ldraw-download.mjs
```

See [3D models of your sets](install.md#optional-3d-models-of-your-sets) for the rest.

## Address and domain

Don't assign a domain to the resource in Coolify. The app listens on `127.0.0.1` inside the Tailscale container's network, and is only served at:

```
https://<TS_HOSTNAME>.<your-tailnet>.ts.net
```

`TS_HOSTNAME` defaults to `brickfolio`. The first visit can take a few seconds while Tailscale gets the HTTPS certificate. Open it from a device signed in to your tailnet.

Set `APP_URL` to that address so alerts link back to the app.

## Troubleshooting

### "Image cache: EACCES: permission denied, mkdir '/app/data'"

Shown in the sync message after every sync, on Coolify installs before 0.21.0.

- **Cause:** the Coolify compose file had fallen behind `docker-compose.yml` and didn't pass `IMAGE_CACHE_DIR`, so photos went to `/app/data`, which the app can't write to.
- **Fix:** redeploy so Coolify reads the current `compose.coolify-tailscale.yml` (0.21.0 or later). With a Docker Compose Empty resource, paste the current file first. From 0.21.0 the cache also sits next to the database (`/data/images`) when `IMAGE_CACHE_DIR` isn't set.
- **If you can't update yet:** setting `IMAGE_CACHE_DIR` in the Environment Variables tab alone doesn't help, because the old compose file doesn't pass it to the app (see [A key or setting seems ignored](#a-key-or-setting-seems-ignored)). Edit the compose file instead: under `app:` → `environment:`, add `- IMAGE_CACHE_DIR=/data/images`, then redeploy. Or set `IMAGE_CACHE=off` the same way to stop keeping photos.

### A key or setting seems ignored

Check that the variable is listed under `environment:` in the compose file Coolify uses (see [Environment variables](#environment-variables)), then redeploy. **Settings → Rebrickable** and **Settings → Brickset** each have **Test key**: "REBRICKABLE_API_KEY isn't set on the server." means the variable isn't reaching the container.

### `manifest unknown` or `not found` when pulling

The tag in `BRICKFOLIO_IMAGE` doesn't exist. Check it against the tags above, or use `:main`.

More messages are in [troubleshooting.md](troubleshooting.md).
