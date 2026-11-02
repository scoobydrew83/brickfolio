# Security policy

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's **Report a vulnerability** button on the Security tab of this repository (private vulnerability reporting). You should hear back within a week.

## Deployment notes

- The app has no built-in login. Its security depends on the auth mode matching how it's exposed:
  - `AUTH_MODE=none` is only safe when the port is reachable from the same machine (the default compose binds `127.0.0.1`).
  - `AUTH_MODE=tailscale` trusts the `Tailscale-User-Login` header. Only run it with `compose.tailscale.yml`, which makes the app listen on `127.0.0.1` inside the Tailscale container so no one can send that header directly.
  - `AUTH_MODE=cloudflare-access` verifies the Access JWT signature, issuer and audience on every request.
- API tokens are stored as SHA-256 hashes. Revoke unused tokens in Settings.
- The REST API refuses writes (POST, PATCH, DELETE) that rely on browser identity unless they come from the app's own site (`Origin` / `Sec-Fetch-Site`), and requires `Content-Type: application/json` (or `text/csv` for import). This stops other websites from making changes through your browser. Requests with an API token are exempt.
- With Cloudflare Access, keep the application's cookie setting at `SameSite=Lax` (the default) unless you have a reason to change it.
- Keep BrickLink keys and `CRON_SECRET` in `.env` or Wrangler secrets, never in the repository.
