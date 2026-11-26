# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.22.0] - 2026-11-26

**Before upgrading, back up your database:** this release adds migration **0037** (two columns on `set_copies`, `ADD COLUMN` only; safe on D1). No new settings. Brickfolio now also calls `api.frankfurter.dev`, only when you save a price paid in another currency.

**Coolify users:** if you still see "Image cache: EACCES: permission denied, mkdir '/app/data'", redeploy so Coolify reads the current `compose.coolify-tailscale.yml`. Adding `IMAGE_CACHE_DIR` in Coolify's Environment Variables tab alone doesn't help with the older file, which doesn't pass it to the app (the 0.21.0 notes said otherwise; corrected below).

Guides for Coolify, backups, troubleshooting, alerts, upgrading, the API, the architecture and common questions; building instruction PDFs on each set's page; plain explanations when the database fails; and prices paid in another currency, converted at the ECB rate.

### Added
- **Prices paid in another currency:** next to **Price paid**, **Paid in** picks the currency you paid in (the 30 currencies the ECB publishes rates for). On save, Brickfolio converts it to your collection currency at the European Central Bank rate for the copy's acquired date (today without one; a weekend or holiday uses the last working day's rate), from frankfurter.dev (free, no key). Price paid keeps the converted amount, so cost basis and gain work as before; what you typed is kept (`paidAmount`, `paidCurrency`) and the form shows "€80.00 is $88.00 at the ECB rate". Changing the acquired date converts again. Tax and shipping stay in the collection currency. Each date and pair is fetched once and kept in settings. When no rate can be had, the save is refused with the reason, never stored unconverted. The API takes `paidCurrency` on copies (a `pricePaid` without it is in the collection currency), and the CSV export adds `paidAmount` and `paidCurrency` as its last columns. Migration 0037.
- **Friendlier database errors:** when the database can't be opened or read, every page shows what's wrong in plain words and how to fix it (locked by another process, the data folder isn't writable, the file is missing or damaged, the disk is full, migrations haven't run, the D1 binding or the libSQL/Turso connection), above a page that offers **Retry** and the reference to look for in the server log. The header no longer breaks along with it. `/api/health` adds the kind of problem (`{"ok": false, "problem": "locked"}`), never the error itself. No migration.
- **Guides:** `docs/coolify.md` (Coolify setup, variables, volumes and image tags), `docs/backup-restore.md` (daily backups, restoring, D1 and Turso, testing a restore), `docs/troubleshooting.md` (sync and API messages with causes and fixes, moved from docs/install.md), `docs/alerts.md` (every alert and channel, the JSON payload, n8n and Home Assistant, moved from docs/install.md), `docs/upgrading.md` (each setup, pinning a version, migrations, rolling back), `docs/api.md` (tokens, every REST route and MCP tool), `docs/architecture.md` (the code for contributors) and `docs/faq.md` (prices, privacy, hosts, Home Assistant and Grafana). README and docs/install.md link them.
- **Building instructions on the set page:** with a Brickset key, each set's page lists LEGO's instruction PDFs (Brickset `getInstructions2`, which doesn't count against the key's daily limit). Only https links to lego.com or brickset.com are shown. Each server keeps the list for a week (an hour after a failure), and the page waits at most 4 seconds for Brickset, so a slow or missing answer just leaves the section out. No migration.

### Fixed
- **Corrected advice for the Coolify image cache error:** the 0.21.0 notes suggested adding `IMAGE_CACHE_DIR=/data/images` in Coolify's Environment Variables tab. Coolify passes only the variables a compose file lists, and the compose file before 0.21.0 didn't list it, so that did nothing. Redeploy with the current compose file instead (or add the variable under `app:` → `environment:` in the file). The 0.21.0 entries and docs/coolify.md say so now.

## [0.21.0] - 2026-11-26

**Before upgrading, back up your database**, as always. This release has no database migrations (the latest is still 0036 from 0.19.0). New settings, all optional: `ALERT_EMAIL_TO`, `ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID`, `ALERT_PUSHOVER_TOKEN`, `ALERT_PUSHOVER_USER`, `ALERT_GOTIFY_URL`, `ALERT_GOTIFY_TOKEN` and `SYNC_ALERT` (see `.env.example` and docs/install.md → Optional: alerts).

**Coolify users:** redeploy so Coolify reads the updated `compose.coolify-tailscale.yml`. Setting `IMAGE_CACHE_DIR` in Coolify's Environment Variables tab doesn't fix the image cache error on its own (corrected in 0.22.0): redeploying with this compose file does.

Fixes the image cache error on Coolify installs ("EACCES: permission denied, mkdir '/app/data'") and names the sets behind failed new/used price lookups. The Sets page filters take several values per group, with a Filters sheet on phones. Alerts can now go to email, Telegram, Pushover and Gotify as well as the webhook, a sync that fails or finishes with problems sends an alert, and Settings → Alerts and sync shows the channels, a test button and the last ten syncs.

### Added
- **More alert channels:** besides the webhook (ntfy, Discord, or JSON for n8n and Home Assistant), alerts can go to email (`ALERT_EMAIL_TO`, through the sign-in email provider), Telegram (`ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID`), Pushover (`ALERT_PUSHOVER_TOKEN`, `ALERT_PUSHOVER_USER`) and Gotify (`ALERT_GOTIFY_URL`, `ALERT_GOTIFY_TOKEN`). Set any number: each alert goes to all of them, and counts as sent when one takes it; a channel that fails is named in the sync message instead of making the working ones repeat the alert. No migration.
- **Sync problem alerts:** when a sync fails or finishes with problems (failed set lookups, a step's error, an alert that didn't go through), the alert channels get one message saying what went wrong, and one when a sync is clean again. The same problem isn't repeated every night. `SYNC_ALERT=off` turns it off. No migration.
- **Settings → Alerts and sync:** the channels in use, **Send a test alert**, and the last ten syncs with their messages. No migration.

### Changed
- **Sets page filters:** pick several values in a group (e.g. Harry Potter and LEGO Ideas, or New and Used): a set matches any of them, and groups still combine. On phones the five chip rows that ran off the screen are one **Filters (n)** button that opens a sheet from the bottom with every group wrapped, **Clear all** and **Show N sets**. From 640px the rows stay inline and wrap. The chosen filters show as removable chips ("Theme: Harry Potter ×") with **Clear all**. Links keep working: a group with several values repeats its parameter (`?theme=Harry+Potter&theme=Ideas`), and the MCP `list_sets` tool still takes one value per filter. No migration.

### Fixed
- The Coolify compose file now passes `PRICE_SWING_PCT`, `RETIRE_ALERT_DAYS`, `DESIGNER_ALERT_DAYS`, `OFFER_MAX_AGE_DAYS` and the email settings through (Coolify has no `.env` file, so they were ignored there).
- **Coolify installs: "Image cache: EACCES: permission denied, mkdir '/app/data'" after every sync.** `compose.coolify-tailscale.yml` had fallen behind `docker-compose.yml` and left out `IMAGE_CACHE`, `IMAGE_CACHE_DIR`, `IMAGE_CACHE_WARM` and `SHARE_BASE_URL`, so photos went to `/app/data`, which the app can't write to. The file has them again, a test fails when it falls behind the other two compose files, and without `IMAGE_CACHE_DIR` the cache now sits in an `images` folder next to the database (`/data/images` on Docker) instead of `./data/images`. Redeploy in Coolify to get the updated compose file. (Corrected in 0.22.0: adding `IMAGE_CACHE_DIR` in Coolify's Environment Variables tab alone doesn't reach the app with the older compose file.) No migration.
- **"N new/used price lookups failed" now names the sets.** The sync message lists the first two (e.g. `10280 used: BrickLink: …`) and the server log has one line per failed lookup, with BrickLink's reason. No migration.

## [0.20.0] - 2026-11-25

**Before upgrading, back up your database**, as always. This release has no database migrations (the latest is still 0036 from 0.19.0), and no new settings.

The interface moved onto shadcn/ui (Base UI underneath) while keeping Brickfolio's look (#109): a command palette, a People admin panel, confirmations and toasts, tooltips that work on touch, searchable dropdowns and a date picker, a sortable set table and a new phone menu.

### Added
- **shadcn/ui set up for contributors** (Base UI primitives): `components.json`, `npx shadcn add <name>` writes to `components/ui/`, shadcn's colour variables point at Brickfolio's tokens in light and both dark modes, Better Auth UI's registry is configured, and `.mcp.json` plus the shadcn agent skill (`.claude/skills/shadcn`) help AI agents. Brickfolio's own components move to `components/ui/kit/` (still imported from `@/components/ui`). `cx` now resolves conflicting Tailwind classes (the `cn` package), which shows two looks the code already asked for: the BrickLink link icons on set cards, the wishlist, minifigures and Designer projects are full size (16px instead of squeezed to 12px), and **Remove** on a set's copy is red. Nothing else looks different. No migration.
- **Command palette (⌘K):** press ⌘K / Ctrl+K anywhere, `/` when not typing, the search button in the header (from 640px) or **Search** at the top of the phone menu to jump to a page, one of your sets (by number or name, opening its page), a minifigure, a wishlist item, a part in your sets or a loose part, or to run an action: Add set, Scan a barcode, Paste a list, Sync now (admins), switch collection and theme. Arrow keys move, Enter opens, Escape closes. Search runs on the server, 150 ms after typing stops, from 2 characters, at most 8 results per group, and only over what you may read: your collections' sets, minifigures and set parts (the selected collection, as on every page), the shared wishlist and loose parts, and Store and Orders for admins only. Also as `GET /api/v1/search?q=` (in the OpenAPI description; 401 when signed out, 400 over 64 characters). The Parts and Loose parts pages take `?q=`, and the Sets page `?add=set` and `?add=list`. Built on shadcn's `command` and `dialog` (adds `cmdk`), restyled to Brickfolio's tokens. No migration.
- **Searchable dropdowns and a date picker (#105):** long lists are a combobox (`Combobox` in `@/components/ui`, Base UI via shadcn): type to filter, arrow keys, Enter, Escape, and tap on phones. Locations (adding and editing a set or copy, Paste a list, scanning, minifigures, loose-part lots and the parts-file import) can also **Add location "…"** from what you type, which creates it exactly as Settings → Locations does (admins only; others see that refusal) and picks it. The loose-parts location filter, the minifigure series (checklist and scanning), the shared collection's theme filter and a lot's colour (BrickLink colour names, or a number typed in as before) are comboboxes too. The dates on a copy, a Designer project's pre-order and a share link's expiry use a calendar (`DatePicker`) from 640px, with the week starting on your browser's first day of the week and a clear button; phones keep the native date field. Every field posts the same value as before. Short lists (condition, status, sort, role, collection and the like) stay native selects. The calendar (`react-day-picker`) loads only in the browser when first opened; the Worker grows about 100 KB raw, 30 KB gzip. No migration.
- **People admin panel** (Settings → People): a table of everyone with search, sorting and paging, and a panel per person with Overview (role and collections, password, two-factor reset, acting as them, ban, delete) and Sessions (where they're signed in; end one or all). **Ban** (with a reason and an end date, or until unbanned) ends their sessions at once and refuses every sign-in method and their API tokens until it ends, in every sign-in mode. **Delete** (type their email) also removes their roles, invitations, API tokens, passkeys and two-factor. **Reset two-factor** replaces the SQL docs/install.md had. **Act as** someone (Better Auth sign-in) shows Brickfolio with their rights, with a bar under the header and **Stop**. These run as server actions with Brickfolio's own admin check, so `ADMIN_USERS` admins can use them, and Better Auth's `/api/auth/admin/*` endpoints follow the same rules: nobody bans, deletes or acts as themselves or an `ADMIN_USERS` admin, and nothing admin-only works while acting as someone. A reusable `DataTable` (TanStack Table) joins `@/components/ui`. No migration.
- **Set table (#106):** the Sets page's Table view is built on the shared `DataTable`. Click a column header to sort by it (again to reverse); the Sort select lists the same columns (Set #, Copies, Name, Theme, Location, Condition, Year, Pieces, Avg sold, Est. Value) with a button beside it to reverse the order, and both stay in step, in the table and the cards (`?sort=…&dir=asc|desc`; each column starts in its natural direction, blanks last). **Columns** hides columns, remembered in this browser. The header row stays put while the table scrolls in its own frame, and the set number stays at the left edge when scrolling sideways (phones too). Each row's icon buttons (and the inline Retry under a failed lookup) become one ⋯ menu: Edit, Parts list, Retry lookup (when the lookup failed) and Remove (asks first), by keyboard or tap. Sorting 500 sets takes about as long as before (about 0.3 s in a test browser), and scrolling them stays at 60 fps. `Menu` (shadcn's dropdown menu) joins `@/components/ui`; `DataTable` gains controlled sorting, a Columns menu, a fixed header and pinned columns. No migration.

### Changed
- **The last components on shadcn (#108):** each `@/components/ui` export is either built on shadcn / Base UI or kept as it is, with the reason, in `docs/design.md` (shadcn and Base UI underneath). `Segmented` (Cards/Table, Sold/Bought and the like) is now shadcn's `toggle-group`: one Tab stop, and the arrow keys move between the options. The phone menu is shadcn's `sheet` from the right, with the same look and behaviour (Escape, a tap outside, a link, a route change or a wide screen close it; focus stays inside and goes back to the menu button). While the phone menu is open, ⌘K, Ctrl+K and `/` don't open the command palette, as over a dialog; its **Search** row still does. `Dialog` stays a native `<dialog>`, and `cx` stays as another name for `cn`. Nothing else looks different. The Worker grows about 11 KB raw, 1 KB gzip. No migration.
- **Colour tokens for the last raw colours:** dialog, sheet and phone-menu backdrops (`scrim`), text on the red danger button (`on-danger`), the header's white text and hover fill (`on-header-strong`, `header-hover`) and the chips on the 3D viewer's tile (`tile-raised`) are now tokens in `app/globals.css`. Nothing looks different, except that the backdrop is a little darker in dark mode (65% instead of 50%) so dialogs stand out from the dark page. A test fails on `black`, `white` or hex colours in views, outside a few listed exceptions (the camera overlay, the browser theme colour, the manifest and the app icon). The web app manifest's colours now match the app (`#e3eaf0` page, `#14212b` header; they were left over from an earlier palette). No migration.
- **Confirmations and toasts (#103):** destructive actions ask in a styled dialog (Base UI alert dialog, `Confirm` / `confirmAction()` from `@/components/ui`) instead of the browser's `confirm()`, with focus on Cancel. Clearing the scan list (sets and minifigures) and deleting a passkey use it, and these now ask first too: removing a set (replaces the two-step button on cards, the table and the set page), the last copy of a minifigure, a wishlist set, a Designer project you follow, a 3D model or a loose-parts lot (inline in its dialog), revoking a share link or an API token, cancelling an invitation and declining one. Short successes ("Saved.", "Added …", "Removed …", "Copied") are toasts (Sonner) at the bottom of the screen, centred on phones and bottom-right from 640px, above the phone menu; errors, warnings, reset and invitation links, new tokens and results the server writes out (imports, quick add, reservations) stay on the page. No migration.
- **Tooltips that work on touch and keyboard (#104):** the browser's `title` tooltips (hover only, never on phones) are replaced by `Tip` from `@/components/ui` (shadcn `tooltip` on Base UI, restyled: Inverse ink with On-inverse text, Chip radius, no shadow or animation). Tips show on hover, on keyboard focus and on a tap, and hide on the next tap, Escape or scroll; the tap still runs the button or link, and the tip sits beside the control, never over it. Every `IconButton` shows its label this way, as do the header's scan, search, theme and account buttons, the nav icons between 640px and laptop widths, the BrickLink and project links, the 3D badge, and values that are cut off or need their source (set names and details on cards, retirement dates, BrickLink sales, missing pieces, cost coverage, Radar gains, the wishlist's average sold, the retail gain line). Plain text with a tip can take focus. Tips that only repeated the visible text (the `2x` count on cards and the set page) and the "Signed in as" tip over the Sets page's buttons are gone. A test fails on a new HTML `title` attribute. No migration.
- **Phone menu:** the bottom tab bar (up to eight pages) is replaced by a menu button in the header that opens a side panel with every page, Store and Orders grouped under "Your BrickLink store", Settings, your account and the theme switch. The wishlist count and update dot show in the panel, and as a dot on the menu button. Pages no longer leave room at the bottom for the bar.

### Fixed
- **Long locations on set cards (#118):** on phones a long location name no longer makes the Sets page wider than the screen (it scrolled sideways). It's cut off with "…", and the full name shows in its tip on hover, focus or tap.
- **Date picker for screen readers (#119):** the calendar's buttons and menus are announced in the browser's language ("Zum nächsten Monat", "Monat auswählen", "Heute, Mittwoch, 25. November 2026"), not always in English. The matching react-day-picker locale (about 8 KB) loads with the calendar, only in the browser; English loads nothing extra, and the Worker grows by about 2 KB gzip.
- **Searchable dropdowns and the date picker outside dialogs:** they opened but showed nothing anywhere that isn't a dialog: the scan page's location, the loose-parts location filter, the shared page's theme filter, the minifigure series pickers and the share-link expiry date in Settings. They show again, and a test stops it from coming back (`components/ui/kit/portal.test.ts`).
- **Ban end date (#120):** Settings → People → Ban → "Until a date" uses the same date picker as every other date field (the calendar from 640px, the phone's own date input below). It posts the same date as before.

## [0.19.0] - 2026-11-23

**Before upgrading, back up your database.** Migration 0034 creates Better Auth's tables, 0035 copies your people and their collection roles into them (inserts only; `users` and `collection_members` are kept), and 0036 adds the passkey and two-factor tables and `user.two_factor_enabled`. Nothing is rebuilt. API tokens are copied into Better Auth's `apikey` table the first time the new version runs; `api_tokens` is kept for a rollback. **Nothing changes for sign-in until you set `AUTH_MODE=better-auth`;** before switching, set `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` and use **Settings → People → Set password** on yourself while still signed in the old way.

### Added
- **libSQL / Turso database:** `DATABASE_URL=libsql://…`, `https://…` or `file:…` (with `DATABASE_AUTH_TOKEN` for Turso) uses libSQL instead of the SQLite file, with the same schema and migrations, for hosts without a lasting disk (Vercel, Render's free plan). Unset, nothing changes.
- **Better Auth sign-in (`AUTH_MODE=better-auth`):** email + password accounts with `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`. The first account is an admin (even when two sign up at once, only one is); sign-up then closes unless `ALLOWED_USERS` lists the email or `BETTER_AUTH_OPEN_SIGNUP=1`. **Settings → People** gains **Set password** and **Reset link** (shown once to copy when email isn't set up), and `/reset-password` takes the new password. On Cloudflare Workers passwords use PBKDF2-SHA256 (100,000 iterations); elsewhere scrypt; either verifies on any host. Collections stay in step with their Better Auth organizations (made, renamed and deleted with them), a collection has at most 90 members (D1's parameter limit), and Better Auth's member endpoints follow Brickfolio's rules (admins change anyone; nobody else changes their own role). Non-email Tailscale logins stay on `AUTH_MODE=tailscale`. Accounts other than the first must confirm their address by email before they can sign in (so sign-up beyond the first account needs email set up); an admin setting someone's password, or a reset link, also confirms it. Setting your own password while an admin keeps you an admin after the switch. Better Auth's organization, admin and API-key endpoints refuse people not in `ALLOWED_USERS`. Migrations 0034 and 0035 only create tables and insert rows.
- **Sign in with Google, GitHub or Apple, or an emailed link (`AUTH_MODE=better-auth`):** each provider is on when its keys are set (`GOOGLE_CLIENT_ID`/`_SECRET`, `GITHUB_…`, `APPLE_…`; redirect URI `<BETTER_AUTH_URL>/api/auth/callback/<provider>`). Sign-up rules are unchanged; a provider-verified address counts as confirmed, so provider sign-up works without email set up, and an unverified one gets no account. People already in **People** sign in with a provider account of the same verified address (linked, roles kept; an unconfirmed password on that account is dropped); unverified addresses are never linked. With email set up, **Email me a sign-in link** sends a one-time link (10 minutes, confirms the address, 5 requests per 5 minutes per IP). Someone not in `ALLOWED_USERS` can't sign in by any method. Callback errors show readably on the sign-in page. No migration.
- **Passkeys and two-factor (Better Auth):** people add passkeys on their account page (named; rename and delete) and sign in with **Sign in with a passkey** or the browser's autofill (`@better-auth/passkey`; the hostname comes from `BETTER_AUTH_URL`). Two-factor sign-in with an authenticator app (TOTP, issuer "Brickfolio") and 10 single-use backup codes: turned on with the password, a QR code and a confirming code; password sign-in and emailed sign-in links then ask for a code at `/sign-in/two-factor` (or a backup code; a device can be trusted for 30 days). Passkey sign-in skips it, as a passkey is already two factors, and so do Google, GitHub and Apple sign-ins. Passkey sign-in, adding passkeys and changing two-factor are refused to people not in `ALLOWED_USERS` or with an unconfirmed address. Migration 0036 only creates the `passkey` and `two_factor` tables and adds `user.two_factor_enabled`. No SMS or email codes.
- **Invitations:** admins (any collection) and owners (their collections) invite someone by email as viewer, editor or owner, from **Settings → Invitations**, with a pending list to copy a link or cancel. The link (`/invite/<id>`) is mailed when email is set up, else shown to copy. The invited address may create an account while sign-up is closed, but only with email set up, since it must be confirmed; accepting needs a signed-in, confirmed address that matches, and gives the role with the inviter's rights at that moment. Invitations expire after 7 days and count toward the 90-member limit. Better Auth's invite, accept, reject and cancel endpoints follow the same rules. No migration.
- **Account page (`/account`, `AUTH_MODE=better-auth`):** change your name and password (signing out other sessions), see where you're signed in and sign out one session or everywhere else, list and remove sign-in methods (never the last one), add a password to a provider-only account, and accept invitations. A person icon in the header links to it. The email address can't be changed (it keys roles, API tokens and share links).
- **One-click hosting on Vercel, Railway and Render** ([docs/hosting.md](docs/hosting.md)): `vercel.json` (Turso database, migrations during the build with `npm run db:migrate`, a daily Vercel Cron), `railway.json` (the Dockerfile with a volume at `/data`, health check, the app's own scheduler) and `render.yaml` (persistent disk on a paid instance) plus `deploy/render-turso.yaml` (free instance with Turso and a daily cron job), with Deploy buttons in the README. On Vercel the app refuses to start without a libSQL `DATABASE_URL` and says so, runs no in-process scheduler, keeps no photo cache, and `BETTER_AUTH_URL` defaults to the production address. No migration.
- **`GET /api/v1/sync/cron`:** starts the daily sync for cron services that only send GET (Vercel Cron) or a `curl` from anywhere; only `Authorization: Bearer <CRON_SECRET>` is accepted, and it does nothing when a sync already started that day. Without BrickLink keys it still runs the Rebrickable and Brickset steps once a day, as the always-on scheduler does; on Vercel the Rebrickable catalog import defaults to `owned` (as on D1). `scripts/cron-trigger.mjs` calls it (and with `--wait` follows the sync to the end). `GET` and `POST /api/v1/sync` are unchanged.
- **`SYNC_TIME_LIMIT`:** seconds after which a sync stops starting new work, for hosts that stop a function after a fixed time (default 180 on Vercel, none elsewhere). Sets are then looked up oldest first, so the ones a short sync didn't reach go first the next day; the rest of the run (history, alerts) still finishes.
- **Email:** `lib/email` sends password reset, verification, invitation and sign-in emails for Better Auth through `EMAIL_PROVIDER` = `smtp`, `resend`, `postmark`, `ses` or `cloudflare` (Email Service REST API or `send_email` binding), from `EMAIL_FROM`. Off until set; see [Optional: email](docs/install.md#optional-email).

### Changed
- **API tokens move to Better Auth's apiKey table (`apikey`).** Every existing token keeps working with the same secret, owner and permissions: on first use the server copies `api_tokens` into `apikey` (the same SHA-256, stored as base64url), once, idempotently, safe with several servers at once. `api_tokens` is kept as it was for going back (nothing new is written there; revoking a copied token deletes its old row too, so a rollback doesn't bring it back). Tokens without an owner (from before 0.18.0, or made with `AUTH_MODE=none`) still act as an admin; they belong to no account, and admins see them in **Settings → API tokens** as "no owner" and revoke them there. New tokens can expire after 30, 90 or 365 days (default: never), and the list shows when each was created, last used and expires. Tokens are also accepted as `x-api-key: <token>`. The last use is recorded at most once a minute per token (it was every request). With `AUTH_MODE=better-auth`, Better Auth's `/api/auth/api-key/*` endpoints manage only your own keys (no rate limit, `bf_` prefix only). No migration file: no table is changed.

## [0.18.0] - 2026-11-20

**Before upgrading, back up your database.** Migration 0032 adds the `collections` and `collection_history` tables, a `collection_id` column on `minifigs` and `share_links`, and puts every existing copy and minifigure in "My collection". The minifigure number indexes become per collection (an index change, no table rebuild). Migration 0033 adds the `users` and `collection_members` tables and an `owner` column on `api_tokens` and `created_by` on `share_links`. Nothing is rebuilt.

### Added
- **People and permissions:** `ADMIN_USERS` (comma-separated logins) names the admins, who can do everything. Everyone else sees only the collections they have a role in, given under **Settings → People** (admins) or by the collection's owner: **viewer** (sees it), **editor** (adds, changes and removes its sets and minifigures) or **owner** (also its members and share links). "All collections" means all of theirs, the switcher lists only those, and buttons for things they can't do are hidden; the server refuses them anyway ("You don't have permission to …", 403 on the REST API). Shared lists (wishlist, Designer projects, layouts, loose parts, builds, saved barcodes) can be changed by admins and anyone who is an editor or owner somewhere. Settings, the sync, keys, locations, collections, Store and Orders are for admins; others get a short Settings page with their roles, the members and share links of collections they own, and their own API tokens. People show up after their first visit, or an admin adds them beforehand. Scans, the offline scan list, the minifigure checklist and MCP tools count only the caller's collections.
- **Multiple collections:** **Settings → Collections** adds, renames, reorders and deletes collections (a collection can only be deleted when it's empty and no share link shows it; the last one can't be). With two or more, a switcher in the header picks **All collections** or one, remembered per browser. Sets, totals and the value history, Minifigures, the Radar, What can I build?, the Parts search, the CSV export and the valuation report then show only that collection; "All" matches the numbers from before. A set with copies in two collections appears in both, counting only that collection's copies, and a minifigure can be in several collections with its own quantity in each (looked up once in the sync). New sets, copies and minifigures go to the selected collection, or the first one under "All"; the Collection field on a copy or minifigure moves it (moving a figure into a collection that has it adds the quantities together). The Sets page shows each collection's totals under "All", share links can show one collection, and each sync saves per-collection history. An install with one collection looks as before, apart from Settings → Collections.
- **API and MCP:** `GET`/`POST /api/v1/collections`, `PATCH`/`DELETE /api/v1/collections/{id}`; `?collection=<id>` on `GET /api/v1/sets`, `/minifigs`, `/history`, `/radar`, `/builds`, `/builds/{mocNo}/wanted.xml`, `/export.csv`, `/report.pdf` and on `/minifigs/{figNo}` (needed to change a figure that's in several collections); `collectionId` in copy, minifigure, bulk add, scanned batch and share link bodies. MCP gains `list_collections`, and `collection_summary`, `search_sets`, `retirement_radar`, `list_minifigures` and `value_history` take a `collection` name or id.
- **Shared minifigure numbers:** the community list can carry Rebrickable → BrickLink minifigure numbers (`minifigNumbers`). Each installation loads them with the daily download, so a set whose parts list comes from Rebrickable needs no BrickLink call for figures on the list. **Settings → Barcode scanning → Share my codes** can include the pairs your server learned from BrickLink's parts lists and the minifigures you own with both numbers, with a checkbox that's off by default (they hint at which sets you own). A pair learned from BrickLink's own list for one of your sets wins over a disagreeing community pair, and the disagreement is logged. Older versions ignore the new section.

### Changed
- **API tokens belong to the person who creates them** and act with their permissions. Tokens from before this version have no owner and act as an admin. A token stops working when its owner is taken out of `ALLOWED_USERS`, and a share link when its maker is no longer an owner of its collection (or an admin). Layouts show only the set copies in your collections; saving a module leaves the copies you can't see where they are. **With `ADMIN_USERS` unset nothing changes:** everyone allowed in is an admin, as before.

## [0.17.0] - 2026-11-19

**Before upgrading, back up your database.** Migration 0031 adds `source` and `mapped` to `set_parts` and `parts_source` to `sets` (columns with defaults; nothing is rebuilt).

### Changed
- **Parts lists from Rebrickable:** with `REBRICKABLE_API_KEY`, a new set's parts list (and **Refresh parts list**) comes from Rebrickable, from the catalog downloads when they have the set or else the API, turned into BrickLink part and colour numbers through the ID map, with spares as extras. It costs no BrickLink call, so more of the daily 5,000 go to part prices. BrickLink's list is used when Rebrickable doesn't know the set or more than `REBRICKABLE_PARTS_MAX_UNMAPPED` percent of its lots (default 2) have no BrickLink number. Rebrickable gives no BrickLink minifigure numbers, so a set with a figure Brickfolio doesn't know yet takes its minifigure lines from BrickLink's parts list (one call) and remembers each Rebrickable → BrickLink pair it can match for certain (the only one left, a unique quantity, or clearly matching names); later sets with those figures need no BrickLink call. A figure BrickLink doesn't list stays in Rebrickable's number and is left out of part-out value and Wanted Lists. The set page says where the list came from and how many lots have no BrickLink match. Lists you already have aren't changed. Piece and lot counts from Rebrickable can differ slightly from BrickLink's. `REBRICKABLE_PARTS=off` keeps lists on BrickLink.
- The daily sync's BrickLink budget now counts the parts-list calls BrickLink actually made (none for a list from Rebrickable), and the server log says how many lists came from each.
- The missing parts Wanted List leaves out parts with no BrickLink number and reports how many (`X-Skipped-Lines`); part-out value reports them as `unmappedLots`.

### Fixed
- **Refresh parts list** no longer drops the parts you marked missing. A set with marks keeps its list's source, and a refresh whose new list would lose a marked part keeps the current list and names the part instead.

## [0.16.0] - 2026-11-19

**Before upgrading, back up your database.** Migration 0030 adds the Rebrickable catalog tables (`rb_sets`, `rb_parts`, `rb_colors`, `rb_inventories`, `rb_inventory_parts`, `catalog_files`); it changes no existing table.

### Added
- **Rebrickable catalog downloads:** with `REBRICKABLE_API_KEY`, Brickfolio downloads Rebrickable's free daily catalog files (no API calls), at most once a day and only when Rebrickable published a new copy (ETag). `REBRICKABLE_CATALOG=full` (the Docker default) keeps themes, sets, parts, colours, LEGO element IDs and every set inventory, streamed row by row so memory stays flat; the first import takes a minute or more (64 s on a test machine), later ones a few seconds, and only changed rows are written. It runs after the BrickLink sync, in the background, and from **Sync Rebrickable now**. `owned` (the default and the most on Cloudflare D1) keeps themes, colours and only the sets you own, want or have alternate builds of. `off` turns it off. A file whose columns changed, or that fails to download, keeps the previous copy and is tried again next sync. **Settings → Rebrickable** lists each file's rows, date and errors.
- **LEGO element IDs:** each element in Rebrickable's catalog is mapped to its BrickLink part and colour through the ID map (`identifiers`, scheme `lego_element`). Elements whose part or colour isn't mapped yet are counted and retried as the map fills in.

### Changed
- Matching a set to Rebrickable takes its theme from the local catalog when it's there (one API call for the minifig count instead of two), and the theme list isn't asked of the API once `themes.csv` is in.
- Dependencies updated, including Next.js 16.4.6, Tailwind CSS 4.3.5, better-sqlite3 13.1.1 and Wrangler 4.162.

## [0.15.0] - 2026-11-16

**Before upgrading, back up your database.** Migration 0029 adds three columns to `wishlist`; nothing is rebuilt.

### Added
- **Price-swing alerts:** the wishlist webhook (`ALERT_WEBHOOK_URL`) now also alerts when a wish's BrickLink average sold price moves `PRICE_SWING_PCT` percent or more (default 10; `0` turns it off), up or down, with or without a target. It measures from the first price seen, then from the price at each swing alert, so each swing alerts once and a slow drift alerts once it adds up. Several swings come as one message, biggest first, with old and new price and the change (`from` and `changePct` on each JSON item).

### Changed
- **Layouts** has its own place in the menu (top bar and phone tab bar) instead of only a button on the Parts page. Between phone and laptop widths the top bar shows icons only (names as tooltips), so it no longer runs off the screen.
- The install guide says Layouts, Loose parts and What can I build? need no setup, and which parts use the Rebrickable key.

## [0.14.0] - 2026-11-11

**Before upgrading, back up your database.** Migrations 0027 (layouts) and 0028 (loose parts) add tables and one column (`builds.kind`); they rebuild nothing, so your sets, copies and builds are kept.

### Added
- **Loose parts:** **Parts → Loose parts** (`/parts/lots`) keeps parts outside your sets in lots: part, colour, quantity, location, condition, an "approximate" flag for guessed counts, and notes. **Import** a BrickLink XML (Wanted List with `MINQTY`, or an inventory or Studio export with `QTY`) or a Rebrickable parts CSV into one location, adding to matching lots or replacing their count. Rebrickable numbers are matched to BrickLink's through the ID map, asking Rebrickable for ones it doesn't know yet; unmatched lines are kept and counted. A malformed file is refused whole; over 5 MB answers 413. **Undo** takes an import back (lots it made go, lots it changed get their count back). Setting a set copy to **Parted out** turns its parts list (with spares, less parts marked missing, no alternates or counterparts) into lots in the copy's location, and its set parts stop counting; putting it back together removes them, unless they were changed or reserved. REST: `GET`/`POST /api/v1/parts/lots`, `PATCH`/`DELETE /api/v1/parts/lots/{id}`, `POST /api/v1/parts/lots/import`, `DELETE /api/v1/parts/lots/import/{batch}`; MCP `list_part_lots`.
- **Reserve loose parts for builds:** **Reserve from loose parts** on a build sets aside what each line still needs from free lots (exact counts before approximate ones, then by location order, then the biggest lot). Reserved parts count as available for that build only. **Nx reserved** lists them by lot with **Release** and **Release all**. A lot can't be lowered below what's reserved on it, and a reserved lot is only removed when you say so. REST: `GET`/`POST`/`DELETE /api/v1/builds/{mocNo}/reservations`, `POST /api/v1/builds/{mocNo}/reservations/auto`.
- **Your own builds and MOCs:** **Add a build** on What can I build? takes a Rebrickable MOC number (name and photo now, parts list with the next sync) or your own build by name, with a parts list file (BrickLink XML or Rebrickable CSV). Filter **All builds / Alternates / My builds**. MOCs and your own builds can be removed; alternates still come from the sync. REST: `POST /api/v1/builds`, `DELETE /api/v1/builds/{mocNo}`, `PUT /api/v1/builds/{mocNo}/parts`, `GET /api/v1/builds?kind=`.
- **MILS layout planner:** **Parts → Layouts** (`/layouts`). A layout is a grid of 32 × 32-stud baseplate modules (up to 24 × 24), with its size in modules, studs and centimetres. Tap an empty square to add a module; select one to name it, set its type (plain, straight road, road corner, T-junction, crossing, custom), turn it in 90° steps, make it a double (1 × 2) or quad (2 × 2) module, move it (tap-to-place, the arrow buttons, or Shift + arrow keys) or remove it. Overlaps and modules past the edge are refused, in the editor and on the server; so is a resize that would cut a module off. Each module links set copies and Rebrickable alternate builds; a copy or build stands on one module at a time, and linking one that's already placed says where it is. Works by touch at phone width (the grid scrolls in its own frame) and by keyboard. REST: `GET`/`POST /api/v1/layouts`, `GET`/`PATCH`/`DELETE /api/v1/layouts/{id}`, `POST /api/v1/layouts/{id}/modules`, `PATCH`/`DELETE /api/v1/layouts/{id}/modules/{moduleId}`, `PUT /api/v1/layouts/{id}/modules/{moduleId}/items`.
- **What a layout still needs:** the layout page's **Parts** list totals every part and colour the layout needs: each linked build's whole parts list (parts in your sets aren't taken off, since those sets stand on the layout too) plus the parts marked missing from linked set copies. A build counts once; lines Rebrickable can't map to BrickLink numbers are counted and left out. Each module shows how many pieces it still needs. **Wanted List** and **Copy XML** export the lines to buy for BrickLink (Want → Upload). `GET /api/v1/layouts/{id}/needs`, `GET /api/v1/layouts/{id}/wanted.xml`, and the read-only MCP tool `layout_needs`.
- **Layouts and loose parts:** a layout's parts list now takes off what's reserved for each build and shows how much free loose parts could cover; **Reserve from loose parts for every build** reserves for each build on the layout (`POST /api/v1/layouts/{id}/reserve`).

### Changed
- **What can I build?** counts loose parts: free lots for every build, reserved lots for their build only. Match % and the Wanted List both follow, and each build says how much comes from loose parts and how much is reserved.

## [0.13.1] - 2026-11-11

### Fixed
- **BrickLink maintenance:** when BrickLink is down for maintenance, the sync says so, with BrickLink's own notice (e.g. when it expects to be back), and stops its BrickLink lookups after the first one, like when the daily limit is used up. Before, every set failed with "request failed".
- BrickLink errors say what happened instead of just "request failed": the HTTP status, the first words of a reply that isn't API data (such as a firewall or maintenance page), or why BrickLink couldn't be reached (a DNS failure, a refused connection, a timeout).
- Each sync writes a summary to the server log (`docker compose logs app`): how many sets were looked up, and one line per different error with the sets it hit. Before, set lookup errors were only shown in the app.

## [0.13.0] - 2026-11-11

### Added
- **Version and updates:** **Settings → About this server** shows the running version and whether a newer release is out, with links to what's new and how to update; a dot on the Settings tab means one is. Brickfolio asks GitHub's public releases list at most once a day (and after each sync); nothing about your collection is sent. **Check for updates** asks now. `UPDATE_CHECK=off` turns it off; demo mode never checks. `GET /api/v1/version`.

### Changed
- **Wishlist:** each set says when its price was last checked, and the page says when the daily sync last ran. A set also counts as **Under target** when a retailer offer is (the chip says "offer"), matching the alerts and the nav badge.
- The install guide's Updating section covers the Deploy to Cloudflare route: sync your fork on GitHub.
- Dependencies updated, including Next.js 16.4.5, three.js 0.187 and Tailwind CSS 4.3.4.

## [0.12.0] - 2026-11-06

### Added
- **Deal alerts from retailer offers:** `POST /api/v1/prices` takes offers your own flows find (n8n, a script, a spreadsheet), at most 200 per request with an `Idempotency-Key`. Ids can be set numbers or box barcodes; ones that don't match come back in `unresolved`. When the lowest offer from the last `OFFER_MAX_AGE_DAYS` (default 3) for a wish, in its condition and your currency, is at or under your target, the wishlist webhook alerts once, naming the retailer and linking to the offer, and again only after it re-arms. The Wishlist page shows the best offer. Offers never change Est. Value. The sources the app syncs itself can't be posted. Example n8n flow: `docs/examples/n8n-retailer-offers.json`. `GET /api/v1/prices` lists stored rows for checking a flow.

### Changed
- The scanner's batch add and the new prices endpoint share one idempotency helper (`lib/service/idempotency.ts`).

## [0.11.0] - 2026-11-06

**Before upgrading, back up your database.** One migration drops the old `sets` columns `qty`, `condition`, `location` and `missing_pct`, unused since 0.9.0 moved them to copies. It changes the table in place; your sets, copies and prices are kept.

### Added
- **New vs. used:** the daily sync also fetches the other condition's BrickLink price guide for each set (used for a mostly sealed set, new for a built or partial one), about weekly, with one price call each. A set's page shows new and used side by side with sales and dates, and how much more new sells for. The Radar shows it per retired or retiring set and as a median. `OTHER_GUIDE_DAILY_CALLS` caps it (default: sets ÷ 7 + 10, up to 1,000; `0` turns it off). `GET /api/v1/sets/{setNo}` returns `gap`; MCP `get_set` and `retirement_radar` include it.
- **Photos in the valuation report:** **Settings → Valuation report → Include photos** (or `GET /api/v1/report.pdf?photos=1`) adds each item's photo, from the image cache (fetched once if missing). PNG and JPEG photos only.

### Changed
- Each copy is valued from its own condition's newest BrickLink price (within 90 days), so a built copy of a mostly sealed set uses used sales once the other guide is fetched.
- Changing a set's copies only looks it up again when the guide it now needs has no price from the last week, saving BrickLink calls.
- The sync shares BrickLink's daily calls in a fixed order: sets, minifigs, wishlist, store, the other guide, then part prices.
- The docs now mark the BrickEconomy barcode lookup as unverified: BrickEconomy's API needs a Premium subscription, and it was written without the API reference and never tested with a real key.
- BrickLink errors say what's wrong: the daily limit is used up, the keys were rejected, the access token is registered for another IP address, or BrickLink has no such item. BrickLink's own words follow in brackets.
- When BrickLink's daily limit runs out during a sync, the sync stops its BrickLink lookups (the rest keep their last prices) and still does everything else, and the sync message says how far it got.

### Removed
- The `sets` columns `qty`, `condition`, `location` and `missing_pct` (see above).

## [0.10.0] - 2026-11-05

**Before upgrading, back up your database.** One migration moves `price_snapshots` and `minifig_price_snapshots` into the new `price_observations` table and drops the old tables.

### Added
- **Image cache:** set and minifigure photos for share pages and offline scanning are kept on your server after first use: `/data/images` on Docker (in the data volume, safe to delete), an R2 bucket on Cloudflare (binding `IMAGE_CACHE`, see docs/cloudflare.md). Only the photo URL stored on a set or minifigure is ever fetched, only from BrickLink and Rebrickable, up to 2 MB. The daily sync fetches up to `IMAGE_CACHE_WARM` (default 200) missing photos. **Settings → Image cache** shows the count and size and can clear it. `IMAGE_CACHE=off` passes photos through without keeping them. `GET /api/v1/images/{set|minifig}/{no}`.
- Scan page offline: photos of sets and minifigures you own still show without a connection (about 300 kept on the device).
- **Value source:** **Settings → Currency → Value source** chooses the one source Est. Value comes from (BrickLink by default). Sources are never averaged together: with another source, a set it has no value for shows no Est. Value. `GET/PUT /api/v1/settings/value-source`.
- The set page lists **Other sources** under Est. Value, each with its type (sold average, asking, estimate, retail, offer), condition, sample size and date.
- `GET /api/v1/sets/{setNo}/observations` and `GET /api/v1/minifigs/{figNo}/observations`: every stored price, filterable by `source` and `type`.

### Changed
- Share pages load photos from `/share/<link>/img/…` instead of BrickLink, so viewers' browsers never contact BrickLink. Photo requests don't count as views. The Funnel overlay no longer forwards `/_next/image`, and the Cloudflare Access bypass needs only `share` and `_next/static` (a `_next/image` bypass can be removed).
- Every price is stored in one `price_observations` table, keyed by set or minifigure number, source, type, condition, currency and day. Price history now survives removing a set and adding it again, and new and used prices fetched on the same day no longer replace each other. Old snapshots move over as BrickLink sold averages in your Settings currency.
- `GET /api/v1/sets/{setNo}/prices` answers as before; it lists prices in the current currency.

### Fixed
- A copy with no value no longer counts as worth 0: a set's "each" value averages the copies that have one, and gain is shown only when every copy with a price paid also has a value (on cards, the set page and the collection totals).

## [0.9.0] - 2026-11-04

**Before upgrading, back up your database** (Docker keeps daily copies in `/data/backups`). The upgrade runs six migrations: every set becomes one copy per unit of its old quantity (condition New becomes **Sealed**, the rest **Built**), and saved barcodes move from `set_barcodes` into the new `identifiers` table. Collection totals don't change.

### Added
- **Deploy to Cloudflare** button in the README. It copies the repo to your GitHub account, creates the D1 database, asks for the secrets with a description of each, and deploys with Workers Builds. `npm run deploy` runs the Cloudflare deploy (build, migrations, deploy).
- **Share links:** **Settings → Share links** creates a read-only link to your collection for someone without access to the app. Values, locations and notes are off by default; minifigures are on. A link can expire, and revoking it takes effect at once. The link is shown once and stored hashed. `GET/POST /api/v1/share-links`, `DELETE /api/v1/share-links/{id}`. `compose.tailscale-funnel.yml` and Cloudflare Access bypass rules open only `/share` (see the install guide). New `SHARE_BASE_URL`.
- **Copies:** each physical copy of a set is tracked on its own, with a status (Sealed, Built, In progress, Parted out), condition, location, acquired and build dates, cost (price paid, tax, shipping), notes and its own Est. Value. A set's page lists its copies with **Add a copy**, **Edit** and **Remove**. A **Gift with purchase** copy costs 0.
- Cost basis and gain: on the Sets page, each card, a set's page and in MCP `collection_summary`, `search_sets` and `get_set`, over the copies with a price paid.
- A **Status** filter on the Sets page. Location, condition and status filters match a set when any of its copies matches.
- `GET/POST /api/v1/sets/{setNo}/copies`, `PATCH/DELETE /api/v1/sets/{setNo}/copies/{id}`. `POST /api/v1/sets` takes the copy fields (`status`, `acquiredDate`, `buildDate`, `pricePaid`, `tax`, `shipping`, `gwp`, `copyNotes`).
- A part and colour ID map from Rebrickable: with `REBRICKABLE_API_KEY` set, the daily sync (and **Sync Rebrickable now**) saves the BrickLink and LDraw numbers Rebrickable lists for every colour (one call, refreshed monthly) and part (20 pages of 1,000 parts per sync by default, `REBRICKABLE_ID_PAGES_PER_SYNC`; a full pass is about 60 pages, picks up where the last sync stopped and is redone monthly). Alternate builds' parts lists add the mappings they come with, and the Brickset sync keeps Brickset's own set ids.

### Changed
- `wrangler.jsonc` no longer has a placeholder `database_id`: the button fills it in, and CLI deploys add it in step 2. `.dev.vars.example` now lists only secrets. `npm run cf:preview` passes `AUTH_MODE=none` itself.
- App pages moved into the `app/(app)` route group, so share pages render without the app's header and nav. URLs are unchanged.
- Existing sets become `qty` copies on upgrade, keeping condition, location, Missing % and value. Condition **New** becomes status **Sealed**; Used, Partial and blank become **Built**. Change a copy afterwards if it was opened. Collection totals are unchanged.
- Sealed copies are valued with BrickLink's new sold prices and built ones with used prices. Until both guides are fetched, a set fetches the guide most of its copies need (ties go to used); a copy in the other guide uses a snapshot from the last 90 days, or is labelled "priced from new/used sales".
- Marked missing parts belong to a copy. Existing marks move to each set's first copy. `GET/PUT /api/v1/sets/{setNo}/missing` and `.../missing/wanted.xml` take `?copy=<id>` (a PUT needs it when a set has several copies and it isn't clear which).
- `PATCH /api/v1/sets/{setNo}` changes condition, location and Missing % only on a set with one copy; with several it answers 409. `qty` adds copies (cloned from the newest, without cost) or removes the newest. `DELETE` removes the newest copy.
- CSV export has one row per copy (with `copyId`, `status`, dates, cost and `copyNotes`); re-importing it updates those copies. The Google Sheet's format still imports, setting the copy count to `qty`.
- Totals, history, the valuation report, Radar, scan "you own N", Designer and "What can I build?" count copies. Parted out copies aren't counted ("parted out: N" in the Sets header).
- Locations: renaming moves copies, and a location can't be deleted while a copy uses it.
- Wishlist **Got it** adds a copy dated today (sealed when you wanted it New); the action takes an optional price paid.
- `sets.qty`, `condition`, `location` and `missing_pct` are no longer read or written; they're dropped in a later release.
- Saved barcodes moved into a new `identifiers` table, one map from every ID scheme (barcodes, LEGO, BrickLink, Rebrickable, Brickset, LDraw) to the BrickLink ID, with the provider's details in `barcode_details`. Upgrading copies every barcode over, and minifigures with both a BrickLink and a Rebrickable number get a mapping. Scanning, the community list and **Settings → Barcode scanning** work as before.

### Fixed
- Docker images build arm64 on a native runner, so releases publish again. The emulated build ran past its 45-minute limit, so the 0.8.1 images never finished.

## [0.8.1] - 2026-11-04

### Fixed
- Alternate builds whose parts list Rebrickable won't share ("You do not have permission to perform this action") no longer fill Settings with errors or get retried on every sync, which kept the sync from reaching other builds. Each is noted and skipped for 90 days; the sync stops after five refusals in a row when none of your builds' lists come through. **Settings → Rebrickable** counts them, and **What can I build?** lists them with links to Rebrickable.

## [0.8.0] - 2026-11-03

### Added
- **Minifigures** scan mode: the square Data Matrix code on Collectible Minifigures boxes tells you which figure is inside, from your own codes, the community list, then the bundled, fan-collected L-Scan table (MIT), preferring the box's factory and year. Figures are linked to the Rebrickable checklist and added to Minifigures. A figure picked by hand from an opened box is remembered as yours. `POST /api/v1/barcodes/minifig`, `POST /api/v1/barcodes/minifig/mappings` and an MCP `lookup_minifig_code` tool.
- **Read the set number:** OCR (Tesseract.js, in the browser) reads the number printed on a box front, for boxes with an unknown or missing barcode. The model files are served by your own server (`/ocr/…`); on Cloudflare they load from jsDelivr, and `OCR_ASSETS_URL` overrides.
- Offline scanning: the Scan page opens without a connection (service worker, scoped to `/scan`). Known boxes are recognised from saved barcodes kept on the device (`GET /api/v1/barcodes/offline`). Adds wait on the device, clearly marked, and are sent once with an idempotency key when you're back. A **Scan barcodes** home-screen shortcut.
- Community barcode list: reviewed barcodes and minifigure codes in `lib/barcode/data/community.json` (CC0), published from the public repository (github.com/scoobydrew83/brickfolio) and downloaded in the daily sync (`COMMUNITY_LIST`, `COMMUNITY_LIST_URL`). **Settings → Barcode scanning → Share my codes** exports your confirmed codes as a prefilled GitHub issue or a file (`GET /api/v1/barcodes/export`). CONTRIBUTING.md explains the review rules.

### Changed
- `POST /api/v1/barcodes/batch` also takes `figs` (scanned minifigures by Rebrickable number), under the same idempotency key.
- The full sync also refreshes the community list.

## [0.7.0] - 2026-11-03

### Added
- Barcode scanner: **Scan** on the Sets page and Wishlist (and a header icon on phones) reads the UPC or EAN on a box with the camera and finds the set. Decoding runs in the browser (the built-in BarcodeDetector, or ZXing where there isn't one, e.g. iPhone Safari), and no picture is uploaded. **One at a time** shows the set and how many you own, then adds it to the collection or wishlist. **Many in a row** keeps the camera on; a box counts again only after it leaves the frame, and the reviewed list is added in one go.
- Barcodes are saved per installation: ones you confirm, and the EAN/UPC the Brickset sync now keeps for sets you own or want. A box nobody knows asks for its set number once and is remembered.
- Optional lookup services for new boxes: CompareTheBricks (`COMPARETHEBRICKS_API_KEY`, free key) and BrickEconomy (`BRICKECONOMY_API_KEY`, experimental), in the order set by `BARCODE_PROVIDERS`. Only the barcode is sent; misses aren't asked again for 7 days.
- API: `POST /api/v1/barcodes/lookup`, `POST`/`DELETE /api/v1/barcodes/mappings`, `POST /api/v1/barcodes/batch` (with an `Idempotency-Key`, so a retry can't add twice) and `GET /api/v1/barcodes`. The MCP server gets a read-only `lookup_barcode` tool.
- **Settings → Barcode scanning** shows which lookups are on and how many barcodes are saved.

### Changed
- The demo data includes three sample barcodes (made-up codes in the 200… in-store range).

## [0.6.0] - 2026-11-03

### Added
- Valuation report: **Settings → Valuation report** (and `GET /api/v1/report.pdf?owner=`) downloads a PDF of every set and minifigure with condition, location, value per copy and in total, how many BrickLink sales each price rests on and when it was fetched, grouped by location, with totals and how values are worked out.
- BrickLink Designer Program tracker on the Radar page (and `/api/v1/designer`): follow projects from crowdfunding to pre-order with stage, series, designer, dates, price and pieces; see whether you own or want the set and add it to the wishlist. Watched projects alert `DESIGNER_ALERT_DAYS` (default 7) before the pre-order opens and 3 days before it closes.
- MCP server at `/api/mcp` (Streamable HTTP, read-only, API-token auth): tools for the collection summary, set search and details, wishlist, Retirement Radar, Designer Program, minifigures, parts search and value history, so Claude and other assistants can answer questions about the collection.

## [0.5.0] - 2026-11-03

### Added
- Retirement Radar (`/radar`, `/api/v1/radar`): sets you own and wishes grouped by expected retirement month, and retired sets ranked by growth per year since they retired, from your stored BrickLink prices (or the retail price when there's no stored price from around then). BrickLink Designer Program and SMART Play sets are flagged. The Sets page notes sets retiring within six months.
- Retirement alerts: the wishlist webhook warns once when a wish will retire within `RETIRE_ALERT_DAYS` (default 60).
- Minifigures as owned items (`/minifigs`, `/api/v1/minifigs`): add figures by BrickLink number, priced from BrickLink sold history in the daily sync, with condition, location, copies and notes. A Collectible Minifigures checklist loads a series from Rebrickable and ticks off the figures you have.
- Quick add: **Paste a list** on the Sets page (and `POST /api/v1/sets/bulk`) takes set and minifig numbers with counts like `10497 x2`. Up to 10 new items are looked up now; longer lists wait for the next sync.
- Part-out value on set pages (`/api/v1/sets/<number>/partout`): the set priced as parts from BrickLink's part price guide, next to its complete price, with coverage and price age. Part prices are cached for 30 days; the daily sync fetches up to `PARTOUT_DAILY_CALLS` (default 1,500) within the BrickLink budget, and **Price parts now** prices one set.

### Changed
- Once 90% of a Partial set's pieces have part prices, Missing % is weighted by what the missing parts are worth instead of by piece count.
- The demo data includes a Designer Program set, minifigures, a Collectible Minifigures series and part prices.

## [0.4.0] - 2026-11-03

### Added
- Complete your Partial sets: mark missing parts on a set's page. Missing % and Est. Value follow from the pieces, the set becomes Partial, and the missing parts download or copy as a BrickLink Wanted List (`/api/v1/sets/<number>/missing`, `…/missing/wanted.xml`). Marks survive a parts refresh.
- Credits: NOTICE lists every data source and bundled asset, `npm run notices` writes THIRD_PARTY_NOTICES.md, and Settings and the README have a Credits section.

## [0.3.0] - 2026-11-02

### Added
- Brickset integration (`BRICKSET_API_KEY`): original retail price and gain over retail per set and for the collection, a Retiring/Retired chip on sets and wishlist items, an Availability filter, and Settings → Brickset with Test key and Sync now.
- A 3D badge on set cards (and an icon in the table) for sets with an LDraw model; it opens the set page on the 3D tab.

### Changed
- Set cards lead with the set name; the number sits above it. Cards in a row are the same height, with their value boxes lined up.

## [0.2.1] - 2026-11-02

### Changed
- The Coolify compose file (`compose.coolify-tailscale.yml`) runs the published image instead of building on the server, so deploys take seconds. `BRICKFOLIO_IMAGE` pins a release.
- GitHub Actions updated (checkout v7, login-action v4), plus minor and patch dependency updates.

## [0.2.0] - 2026-11-02

### Added
- Set pages (`/sets/<number>`): photo, value and price history, parts list, notes, edit and remove.
- Wishlist with target prices, an "under target" alert, daily re-pricing, "Got it" to move a set into the collection, and `/api/v1/wishlist`.
- Optional Rebrickable sync for themes, subthemes and minifigure counts (`REBRICKABLE_API_KEY`), with a theme filter.
- Light and dark themes with a toggle, a shared app shell, and a phone tab bar.
- `npm run seed` for demo data.
- What can I build?: alternate builds of your sets from Rebrickable, ranked by how many of their parts you own, with a BrickLink Wanted List of what's missing (`/build`, `/api/v1/builds`).
- Settings → 3D models downloads (and updates) the LDraw parts library into `/data/ldraw` with one click; `npm run ldraw:download` does the same from a terminal.
- Demo mode (`DEMO_MODE=on`): a read-only public demo that fills an empty database with sample data, refuses changes and switches off outside services.
- A tour GIF and refreshed screenshots in the README, and `scripts/screenshots.mjs` to retake them.
- Settings → Rebrickable shows matched sets and builds, tests the key, and runs a Rebrickable-only sync. Sets Rebrickable didn't know are asked again after 30 days, and the daily job runs Rebrickable even without BrickLink keys.
- 3D models from LDraw's Official Model Repository: **Find model on LDraw** on a set's page, and the daily sync fetches models for sets that have none (`LDRAW_OMR_SYNC=off` to stop it).
- 3D model view on set pages: upload an LDraw model, orbit it, and step through the build (`LDRAW_LIBRARY_DIR` or `LDRAW_LIBRARY_URL`).
- Wishlist alerts: one message per drop under target to ntfy, Discord or any JSON webhook (`ALERT_WEBHOOK_URL`), and a count on the Wishlist tab.

### Changed
- New visual design (the "instruction booklet" look): design tokens, shared components in `components/ui`, documented in `docs/design.md`.
- Store and Orders lead with their lists instead of big-number tiles.

### Fixed
- Editing a set no longer drops a location that isn't in Settings.
- Keyboard focus is visible everywhere, including the header.

## [0.1.0]

### Added
- Collection tracking with copies, location, condition and missing %.
- BrickLink sold prices, piece counts, photos and parts lists, refreshed by a daily sync.
- Value history, CSV import/export, REST API with tokens and OpenAPI description.
- BrickLink store inventory and orders.
- Docker (with Tailscale or Cloudflare Tunnel) and Cloudflare Workers + D1 deployments.
