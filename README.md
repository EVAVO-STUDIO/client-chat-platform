# EVAVO Client Chat Platform

A reusable Cloudflare Worker and isolated browser widget for bounded, multi-tenant website chat.

The active runtime is `worker/src/hardened.ts`. It wraps the historical implementation in `worker/src/index.ts` behind request, authentication, configuration, network, response and source-control boundaries. The historical router remains only for compatibility and is not the Wrangler entrypoint.

## Repository structure

- `worker/` — Workers AI, KV-backed configuration, internal lead capture and authenticated administration.
- `widget/` — Shadow DOM browser embed with bounded requests, bounded responses and accessible keyboard behaviour.
- `admin/` — static operator console for reviewed bot configuration and cache refresh.
- `shared/` — historical shared types retained for compatibility.
- `DEPLOY.md` — Windows PowerShell activation and deployment runbook.
- `docs/security-boundary.md` — authoritative security and trust-boundary description.

## Enforced runtime posture

- Administrator routes accept an exact `Authorization: Bearer ...` credential only.
- `ADMIN_TOKEN` must be 32–256 bytes, contain no whitespace and remain server-side.
- Browser chat requires at least one exact approved origin. Wildcard origins are rejected.
- Non-browser chat without an `Origin` header requires a 16–256 character bot key in `x-bot-key`.
- Bot keys are not accepted in the JSON body and must never be embedded in the public widget.
- Admin and chat JSON bodies are media-type checked, stream bounded and structure bounded.
- Prototype-pollution keys are rejected.
- Public model output cannot expose the provider’s raw response or raw provider error details.
- Public chat never fetches knowledge URLs live.
- Public URLs are fetched only by the authenticated `/admin/kb/refresh` route.
- Every refresh uses public HTTPS only, manual redirect validation, a full-operation timeout, a streamed byte limit and binary-body rejection.
- `global_fetch_strictly_public` is enabled in Wrangler as a second SSRF boundary.
- Cached knowledge uses SHA-256 URL-derived KV keys so long URLs cannot exceed Workers KV key limits.
- Cache records contain source URL, final URL, fetch time, source byte count and a verified SHA-256 text digest.
- Website excerpts are marked as untrusted model context. Instructions found inside fetched pages must not be followed.
- External webhook configuration and execution are rejected by the active boundary.
- Supported model actions are limited to opening a contact path, storing an internal KV lead record, or doing nothing.
- Bot deletion and global bot deletion require exact confirmation phrases.
- Health output does not reveal whether the admin credential is configured.
- Unexpected runtime failures return a generic JSON error.

## Important limitation: KV counters are best effort

The historical rate-limit, daily-budget and lead-index implementations use Workers KV. KV is eventually consistent and does not provide an atomic increment primitive, so concurrent requests can temporarily exceed a configured counter and concurrent index writes can race.

Treat these controls as cost and abuse reduction, not as a strict billing or security quota. A higher-assurance production tier should move counters and coordinated lead indexes to a Durable Object or another transactional service.

## Source-control security

GitHub currently reports this repository as public. The source therefore assumes that every tracked file may be read by anyone.

Run:

```powershell
npm run check
```

The check chain is deliberately ordered:

1. `npm run check:source-secrets`
2. `npm run check:security`
3. `npm run typecheck`

The tracked-source gate rejects:

- real `.env` and `.dev.vars` files;
- private keys;
- common live provider-token shapes;
- credential-bearing database, cache and HTTP URLs;
- non-placeholder sensitive assignments;
- tracked npm authentication tokens.

It reports only a file path and rule name, never the matched value. `.dev.vars.example` is the only reviewed local Worker-variable template. Adding a leaked file to `.gitignore` does not remove it from Git history; exposed credentials must be revoked or rotated.

## Local validation

Use Node.js 24 to match the read-only GitHub workflow.

```powershell
cd C:\GitRepos\client-chat-platform
git pull origin main
cd .\worker
cmd /c "npm ci --no-audit --no-fund"
Copy-Item ..\.dev.vars.example .\.dev.vars
# Replace the ADMIN_TOKEN placeholder in .dev.vars with a random server-only value.
cmd /c "npm run check"
cmd /c "npm run dev"
```

Serve the admin console separately:

```powershell
cd C:\GitRepos\client-chat-platform\admin
cmd /c "npx --yes http-server . -p 4173"
```

The hardened router accepts localhost admin origins for development. A hosted admin console must be explicitly listed in the non-secret `ADMIN_ALLOWED_ORIGINS` Worker variable.

## Reviewed bot configuration

A saved bot configuration must include:

- a valid `botId`;
- at least one exact browser origin;
- a safe relative or public HTTPS contact URL;
- curated knowledge and optional public HTTPS knowledge URLs;
- bounded model, turn, message, rate and daily-budget settings;
- only the supported internal action types.

After changing website source content or knowledge URLs, use **Refresh approved cache** in the admin console or call `/admin/kb/refresh` with authenticated JSON.

Old configurations require review before the hardened runtime will use them when they contain:

- wildcard origins;
- missing origins;
- unsafe or non-HTTPS knowledge URLs;
- webhook URL, webhook authentication or webhook secret fields;
- an invalid bot key.

This is intentionally fail closed. Load the bot in the current admin console, correct the configuration, save it and refresh the cache.

## Widget embed

Host `widget/embed.js` on a static origin and add:

```html
<script
  src="https://static.example.com/embed.js"
  data-api-base="https://client-chat-platform.example.workers.dev"
  data-bot-id="evavo"
  data-title="Ask EVAVO"
  data-greeting="Hi. What would you like help with?"
  data-contact="/contact"
  data-accent="#ff244e"
></script>
```

Supported optional attributes:

- `data-position="left"` — defaults to right.
- `data-style-nonce="..."` — applies a host-provided CSP nonce to the injected style element.
- historical `data-bot` — accepted as an alias for `data-bot-id`.

Do not add a bot key to public HTML. Browser access is controlled by the exact origin list stored in the bot configuration.

## Deployment

Use the guarded root command:

```powershell
cd C:\GitRepos\client-chat-platform
cmd /c "npm run deploy"
```

The Worker package’s `predeploy` hook runs the complete check chain before Wrangler uploads anything. Direct `wrangler deploy` bypasses that npm lifecycle gate and should be reserved for deliberate recovery work.

See [`DEPLOY.md`](DEPLOY.md) for the complete activation, migration, verification and operator procedure.
