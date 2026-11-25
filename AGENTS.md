<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Brickfolio: working rules

Facts and conventions the code doesn't show. Everything else (stack, layout, commands) is in the repo.

## Database rules
- Migrations only add: CREATE TABLE, CREATE INDEX, ADD COLUMN, INSERT. Cloudflare D1 ignores `PRAGMA foreign_keys=OFF`, so a Drizzle table rebuild (`__new_<table>` in the generated SQL) of `sets` or `builds` cascades and deletes related rows on D1. Check every generated migration for `__new_`. Dropping an unused column with `ALTER TABLE … DROP COLUMN` is fine (#63).
- The same code runs on better-sqlite3, D1 and libSQL. D1 allows 100 bound parameters per statement (chunk `IN (…)` lists to about 90) and has no interactive transactions (write so each statement is safe on its own).

## Tests
- GitGuardian scans every commit of a PR, and history isn't rewritten, so a key- or password-shaped literal can't be removed once pushed. Make test secrets, tokens and passwords at run time (`crypto.randomUUID()`), never as string literals.

## UI components
- `@/components/ui` is the component API: views import from it, and its exports (`components/ui/index.ts`, our kit in `components/ui/kit/`) keep their names. Read `docs/design.md` before UI work.
- New components come from shadcn (Base UI underneath): `npx shadcn add <name>`, or through the shadcn MCP server in `.mcp.json`; the `shadcn` agent skill is in `.claude/skills/`. shadcn writes lowercase files to `components/ui/` (`separator.tsx`); import those by path until one is exported from `index.ts`. Never hand-edit `components/ui/kit/` to match a shadcn file name, and never let a generated file replace a kit file.
- Tokens only, never raw colours (`bg-surface`, `text-fg-3`, or shadcn's `bg-background`, `text-muted-foreground`, which map to our tokens in `app/globals.css`): a dialog's backdrop is `bg-scrim`, text on a solid colour is its `on-*` token (`text-on-danger`). A colour with a new job gets a new token, with its night value. `components/ui/kit/tokens.test.ts` fails on `black`, `white` or hex in `app/` and `components/`, outside the few exceptions it lists. Remove shadows, animations and colours a generated component brings that `docs/design.md` doesn't allow.
- The native `<select>` (`Select`) stays for short lists.
- Any UI change: attach phone and desktop screenshots, light and dark, to the PR.

## Where it runs
- The owner's production is Cloudflare Workers (Paid plan) with D1. Docker (Tailscale or Cloudflare Access in front), Vercel, Railway and Render are documented in `docs/install.md`, `docs/cloudflare.md` and `docs/hosting.md`.
- Sign-in modes: `AUTH_MODE=none | tailscale | cloudflare-access | better-auth`. Permissions and roles are in `lib/service/permissions.ts` and apply in every mode.
