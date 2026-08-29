# Client Chat Platform deployment runbook

This is the authoritative Windows PowerShell procedure for validating, migrating and deploying the hardened Cloudflare Worker.

## Runtime being deployed

Wrangler deploys:

```text
worker/src/runtime.ts
```

The active runtime contract is:

```text
client_chat_active_runtime_v2
```

`runtime.ts` removes retired request aliases, applies the reviewed chat/embedding model boundary and timeout, blocks implicit model-driven lead writes, and exposes the explicit visitor-consent route. It delegates ordinary requests to `worker/src/hardened.ts`, which wraps the historical `worker/src/index.ts` compatibility code.

Do not point Wrangler directly at either compatibility module.

## 1. Prerequisites

- Node.js 24.
- Git.
- A Cloudflare account with access to the existing Worker, Workers AI and configured KV namespaces.
- The repository at `C:\GitRepos\client-chat-platform`.
- The current Worker administrator token, or authority to rotate it.

```powershell
node --version
git --version
```

## 2. Synchronise and install the locked dependency graph

```powershell
cd C:\GitRepos\client-chat-platform
git pull origin main
cd .\worker
cmd /c "npm ci --no-audit --no-fund"
```

Use `npm ci`, not `npm install`, for release validation. It must reproduce `worker/package-lock.json` exactly.

## 3. Configure local-only Worker variables

```powershell
cd C:\GitRepos\client-chat-platform\worker
Copy-Item ..\.dev.vars.example .\.dev.vars
notepad .\.dev.vars
```

Replace the placeholder with a random 32–256 byte value containing no whitespace:

```text
ADMIN_TOKEN=replace_me_with_a_random_server_only_token
```

`.dev.vars` is ignored and must never be committed. A hosted admin console must be listed in `ADMIN_ALLOWED_ORIGINS`; localhost and `127.0.0.1` are accepted for local development.

## 4. Run the complete no-deploy release gate

```powershell
cd C:\GitRepos\client-chat-platform\worker
cmd /c "npm run check"
```

The canonical npm chain remains:

1. `npm run check:source-secrets`
2. `npm run check:config-secrets` through the `precheck:security` lifecycle hook
3. `npm run check:security`
4. `npm run check:super-eva`
5. `npm run typecheck`
6. `npm run check:bundle`

`check:super-eva` also runs the portable-widget contract and the chat-model policy guard before its SUPER EVA compatibility assertions. This keeps those checks mandatory without changing the exact canonical command chain protected by the security meta-contract.

`npm run check:bundle` runs Wrangler with `--dry-run` into `.wrangler/dry-run`. It validates the active module graph and configuration without publishing the Worker.

Do not continue after any failure.

## 5. Start and inspect the Worker locally

```powershell
cd C:\GitRepos\client-chat-platform\worker
cmd /c "npm run dev"
```

Wrangler normally exposes the Worker at `http://localhost:8787`.

```powershell
curl.exe -i http://localhost:8787/health
```

Confirm:

- HTTP `200`;
- `securityContract: client_chat_hardened_router_v2`;
- `publicChatNetworkFetch: false`;
- `externalWebhookExecution: false`;
- `X-EVAVO-Chat-Runtime: client_chat_active_runtime_v2`;
- no administrator-configuration disclosure.

## 6. Open the reviewed admin console

```powershell
cd C:\GitRepos\client-chat-platform\admin
cmd /c "npx --yes http-server . -p 4173"
```

Open `http://localhost:4173` and use:

```text
Worker API origin: http://localhost:8787
Admin token: the value in worker/.dev.vars
```

The page does not persist the token.

## 7. Review legacy bot records before production activation

The hardened runtime fails closed when a stored bot contains unsafe network or action configuration.

Review and resave a bot when it has:

- no browser origin list;
- wildcard origins;
- non-HTTPS production origins;
- origins containing paths, credentials, query strings or fragments;
- non-public or non-HTTPS knowledge URLs;
- webhook URL, authentication or secret fields;
- an invalid bot key;
- obsolete lead mode values;
- malformed bounded settings;
- a retired or unreviewed model identifier.

For each bot:

1. enter the Bot ID;
2. select **Load bot**;
3. add every exact public origin that may host the widget;
4. remove wildcard or unsafe entries;
5. review the contact URL, approved knowledge and public knowledge URLs;
6. enable only contact navigation or visitor-approved follow-up;
7. select **Save reviewed configuration**;
8. select **Refresh approved cache**;
9. inspect `attempted`, `refreshed`, `failed` and `cacheVersion`.

The current writer stores schema version 4 and discards unsafe legacy fields rather than silently retaining them.

## 8. Reviewed inference posture

The active public-chat generation fallback is:

```text
@cf/zai-org/glm-4.7-flash
```

The reviewed semantic-retrieval embedding fallback is:

```text
@cf/baai/bge-base-en-v1.5
```

Chat generation and embedding inference are admitted separately. A `messages` request is treated as chat generation; a `text` or `texts` request is treated as embedding inference. An unrecognised inference request shape fails closed.

A missing, malformed, retired or currently unapproved chat-model ID resolves to the reviewed GLM fallback. The former `@cf/meta/llama-3.2-3b-instruct` and `@cf/meta/llama-3-8b-instruct` chat fallbacks are retired. An unapproved embedding model resolves to the reviewed BGE embedding model instead of being redirected through the chat model.

Workers AI calls remain bounded by a 20-second runtime timeout. The chat boundary also normalises supported OpenAI-style `choices[0].message.content` output into the stable legacy `response` field, while embedding responses pass through unchanged.

The answer-quality policy applies only to chat generation. It remains inside the existing 30,000-character system and 75,000-character total-input ceilings; older history is reduced before those ceilings can be exceeded.

The fallback does not rewrite KV. Resave old records through the current admin console so stored configuration truthfully describes runtime behaviour. Do not add a new model merely because its `@cf/...` identifier is syntactically valid; it must be reviewed and admitted in `worker/src/runtime.ts`, `worker/scripts/check-chat-model-policy.mjs` and `docs/chat-model-policy.md` together.

## 9. Knowledge-cache behaviour

Public chat never fetches source pages during a visitor request. Only authenticated:

```text
POST /admin/kb/refresh
```

may fetch configured knowledge URLs.

The refresh boundary:

- accepts public HTTPS only;
- validates redirects manually;
- applies one timeout across redirects, headers and streamed body reading;
- limits bytes and rejects binary-looking bodies;
- strips HTML to bounded text;
- records source URL, final URL, fetch time, source bytes and a verified digest;
- uses a 70-byte SHA-256-derived KV key rather than the raw URL.

```powershell
$WorkerUrl = "http://localhost:8787"
$AdminToken = "<current local ADMIN_TOKEN>"
$Body = '{"botId":"evavo"}'

curl.exe -i -X POST "$WorkerUrl/admin/kb/refresh" `
  -H "Authorization: Bearer $AdminToken" `
  -H "Content-Type: application/json" `
  --data-binary $Body
```

A partial refresh is reported honestly. Failed sources are not replaced with invented text.

## 10. Verify explicit visitor-approved follow-up

A model `create_lead` action cannot write a record during `/api/chat`. The widget must display the exact visitor-provided email and message excerpt and obtain a separate click on **Share for follow-up**.

`POST /api/leads` then requires:

- an exact approved browser `Origin`;
- exact boolean `consent: true`;
- bounded visitor-authored evidence;
- an email and message that both appear in that evidence;
- an active, safe bot configuration.

The evidence is verified but not stored. Raw IP addresses and user-agent strings are not stored. Explicit lead records and their index expire after 90 days.

A local command-line contract check can emulate an approved browser origin after that origin has been saved in the bot configuration:

```powershell
$WorkerUrl = "http://localhost:8787"
$Origin = "http://localhost:3000"
$VisitorMessage = "My email is visitor@example.com and I would like follow-up about a website project."
$LeadBody = @{
  botId = "evavo"
  consent = $true
  evidence = @($VisitorMessage)
  lead = @{
    email = "visitor@example.com"
    message = $VisitorMessage
    sourcePath = "/contact"
  }
} | ConvertTo-Json -Depth 5 -Compress

curl.exe -i -X POST "$WorkerUrl/api/leads" `
  -H "Origin: $Origin" `
  -H "Content-Type: application/json" `
  --data-binary $LeadBody
```

Expected when the origin is approved:

- HTTP `201`;
- `consentVersion: visitor_follow_up_consent_v2`;
- `retentionDays: 90`;
- `expiresAt` present;
- no email, message, IP address or user agent echoed in the response.

Omitting `consent`, changing it to a string, changing a field so it no longer appears in `evidence`, or using an unapproved origin must fail closed.

## 11. Configure production Worker variables

Authenticate Wrangler:

```powershell
cd C:\GitRepos\client-chat-platform\worker
cmd /c "npx wrangler login"
cmd /c "npm run whoami"
```

Set or rotate the server-only administrator credential:

```powershell
cmd /c "npx wrangler secret put ADMIN_TOKEN -c wrangler.jsonc"
```

For a hosted admin console, set the optional comma-separated exact origin list:

```powershell
cmd /c "npx wrangler secret put ADMIN_ALLOWED_ORIGINS -c wrangler.jsonc"
```

Example prompted value:

```text
https://ops.example.com,https://admin.example.com
```

Do not add production values to `wrangler.jsonc` or any tracked file.

## 12. Confirm bindings

`worker/wrangler.jsonc` declares:

```text
AI
BOT_CONFIG
KB_CACHE
```

The namespace IDs are binding identifiers, not bearer credentials. Do not recreate or replace the production namespaces during a routine source release.

## 13. Deploy through the guarded npm lifecycle

```powershell
cd C:\GitRepos\client-chat-platform
cmd /c "npm run deploy"
```

The package `predeploy` hook reruns the complete source, configuration, security, portable-widget/model-policy/SUPER EVA, TypeScript and bundle chain before Wrangler uploads anything.

Direct Wrangler invocation bypasses the npm `predeploy` gate. Do not use direct `wrangler deploy` for a normal release.

## 14. Verify the deployed runtime

```powershell
$WorkerUrl = "https://client-chat-platform.example.workers.dev"
curl.exe -i "$WorkerUrl/health"
```

Confirm:

- HTTP `200`;
- `X-EVAVO-Chat-Runtime: client_chat_active_runtime_v2`;
- no administrator-configuration disclosure;
- no raw model or provider information.

Verify the retired alias cannot authenticate:

```powershell
curl.exe -i -X POST "$WorkerUrl/admin/list" `
  -H "x-admin-token: invalid-placeholder-value-that-is-not-authoritative"
```

Expected: HTTP `401`.

Verify exact Bearer administration:

```powershell
$AdminToken = "<current Worker ADMIN_TOKEN>"

curl.exe -i -X POST "$WorkerUrl/admin/list" `
  -H "Authorization: Bearer $AdminToken"
```

Expected: HTTP `200` with a bounded bot-ID list.

Verify unsupported methods:

```powershell
curl.exe -i "$WorkerUrl/admin/list"
curl.exe -i "$WorkerUrl/api/chat"
curl.exe -i "$WorkerUrl/api/leads"
```

Expected: HTTP `405` with the appropriate `Allow` header.

## 15. Embed the current widget

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

The browser widget is authorised by the exact page origin stored in bot configuration. Never add a bot key to public HTML.

A strict host Content Security Policy may pass its response-specific style nonce through `data-style-nonce`. Do not hard-code or reuse a nonce.

## 16. Operational limitations and incidents

Workers KV is eventually consistent. Current rate limits, daily budgets and lead indexes reduce cost and abuse but are not strict transactional quotas. Concurrent requests can temporarily exceed a counter, and concurrent index writes can race. Use a Durable Object or another transactional coordinator before treating these values as billing, compliance or high-assurance security controls.

When a credential may have entered source control:

1. revoke or rotate it immediately;
2. do not rely on `.gitignore` as remediation;
3. inspect Git history and build logs;
4. remove tracked material with an intentional history-remediation plan;
5. rerun `npm run check`;
6. verify the deployed Worker uses the rotated value.

When a bot configuration is unsafe, do not weaken the runtime to make it load. Resave it through the reviewed schema, refresh approved knowledge, and verify chat and visitor consent from every exact production origin.
