# EVAVO Client Chat Platform

A reusable Cloudflare Worker and isolated browser widget for bounded, multi-tenant website chat.

The deployed entrypoint is `worker/src/runtime.ts` with runtime contract `client_chat_active_runtime_v2`. It removes retired request aliases, applies the reviewed Workers AI fallback, blocks the historical chat action from writing leads implicitly and exposes a separate explicit-consent lead route. It then delegates ordinary routes to `worker/src/hardened.ts`, which wraps the historical implementation in `worker/src/index.ts` behind request, authentication, configuration, network and response boundaries. Neither compatibility module is the Wrangler entrypoint.

## Repository structure

- `worker/` — Workers AI, KV-backed configuration, explicit visitor-approved lead capture and authenticated administration.
- `widget/` — Shadow DOM browser embed with bounded requests, bounded responses, explicit follow-up consent and accessible keyboard behaviour.
- `admin/` — static operator console for reviewed bot configuration and cache refresh.
- `shared/` — historical shared types retained for compatibility.
- `DEPLOY.md` — Windows PowerShell activation, migration and deployment runbook.
- `docs/security-boundary.md` — authoritative trust-boundary description.

## Enforced runtime posture

- The final runtime removes the retired `x-admin-token` header before routing.
- Administrator routes accept an exact `Authorization: Bearer ...` credential only.
- `ADMIN_TOKEN` must be 32–256 bytes, contain no whitespace and remain server-side.
- Browser chat requires at least one exact approved origin. Wildcard origins are rejected.
- Non-browser chat without an `Origin` header requires a 16–256 character bot key in `x-bot-key`.
- Bot keys are not accepted in JSON and must never be embedded in the public widget.
- Admin, chat and lead JSON bodies are media-type checked, stream bounded and structure bounded.
- Prototype-pollution keys are rejected.
- Public model output cannot expose the provider’s raw response or raw provider error details.
- A missing, malformed or known-retired model ID is replaced at runtime with `@cf/meta/llama-3.2-3b-instruct`.
- Workers AI calls are bounded by a 20-second runtime timeout.
- Public chat never fetches knowledge URLs live.
- Public URLs are fetched only by the authenticated `/admin/kb/refresh` route.
- Every refresh uses public HTTPS only, manual redirect validation, a full-operation timeout, a streamed byte limit and binary-body rejection.
- `global_fetch_strictly_public` is enabled in Wrangler as a second SSRF boundary.
- Cached knowledge uses SHA-256 URL-derived KV keys so long URLs cannot exceed Workers KV key limits.
- Cache records contain source URL, final URL, fetch time, source byte count and a verified SHA-256 text digest.
- Website excerpts are marked as untrusted model context. Instructions found inside fetched pages must not be followed.
- External webhook configuration and execution are rejected by the active boundary.
- A model action may open a contact path or propose a follow-up. It cannot write a lead during the chat request.
- Bot deletion and global bot deletion require exact confirmation phrases.
- Health output does not reveal whether the admin credential is configured.
- Unexpected runtime failures return a generic JSON error.

## Explicit visitor-approved follow-up

A `create_lead` model action is only a proposal. During `/api/chat`, the runtime blocks every historical `lead:*` KV read, write and delete, so compatibility code cannot create a record or update a lead index.

The widget then:

1. derives the proposed email, message and optional fields only from visitor-authored messages;
2. displays the exact email and a message excerpt;
3. states that nothing is saved until the visitor selects **Share for follow-up**;
4. sends exact boolean consent, the bounded visitor-message evidence and the proposed fields to `POST /api/leads`.

The lead route independently verifies:

- an exact approved browser origin;
- a bounded JSON object;
- exact boolean `consent: true`;
- a valid bot configuration;
- that every stored field appears in visitor-authored evidence;
- a privacy-preserving best-effort rate bucket.

Visitor evidence is used only for verification and is not stored with the lead. Raw IP addresses and user-agent strings are not stored. The response echoes no contact fields. Explicit lead records and their index are configured to expire after 90 days.

## Important limitation: KV coordination is best effort

The historical rate-limit, daily-budget and lead-index implementations use Workers KV. KV is eventually consistent and does not provide an atomic increment or transaction across keys, so concurrent requests can temporarily exceed a configured counter and concurrent index writes can race.

The explicit lead route attempts to remove a newly written record when its index write fails, but this is compensating best effort rather than an atomic transaction. Treat these controls as cost, abuse and privacy reduction, not as strict billing, compliance or high-assurance coordination. A stronger tier should move counters and coordinated lead storage to a Durable Object or another transactional service.

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
4. `npm run check:bundle`

The final command runs Wrangler’s no-deploy dry-run bundle into the ignored `.wrangler/dry-run` directory. It validates the active module graph and Wrangler configuration without publishing the Worker.

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
- only contact navigation, visitor-approved follow-up or no action.

After changing website source content or knowledge URLs, use **Refresh approved cache** in the admin console or call `/admin/kb/refresh` with authenticated JSON.

Old configurations require review before the hardened runtime will use them when they contain:

- wildcard or missing origins;
- unsafe or non-HTTPS knowledge URLs;
- webhook URL, webhook authentication or webhook secret fields;
- an invalid bot key;
- malformed bounded settings.

A missing or retired model alone does not block chat: the final runtime supplies the reviewed fallback. The stored record should still be resaved through the current admin console so its declared model matches actual operation.

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

The Worker package’s `predeploy` hook reruns source-secret safety, the deterministic boundary contract, TypeScript and the no-deploy bundle before Wrangler uploads anything. Direct `wrangler deploy` bypasses that npm lifecycle gate and should be reserved for deliberate recovery work.

See [`DEPLOY.md`](DEPLOY.md) for the complete activation, migration, verification and operator procedure.
