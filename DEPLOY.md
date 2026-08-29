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

`check:super-eva` also runs the portable-widget contract, chat-model policy, bounded GLM completion-field policy, stored/admin model truth checks, hardened quickstart contract, reviewed EVAVO seed contract and reviewed seed-apply helper contract before its SUPER EVA compatibility assertions. This keeps those focused checks mandatory without changing the exact canonical command chain protected by the security meta-contract.

The seed-apply helper is **validated but never executed** by `npm run check`. Validation must remain read-only.

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

Chat generation and embedding inference are admitted separately. A non-empty `messages` request is treated as chat generation; scalar `text`, provider-documented batch `text: string[]`, or the legacy `texts` form is treated as embedding inference. An unrecognised inference request shape fails closed.

EVAVO deliberately admits a narrower embedding envelope than Cloudflare's general model API. Each embedding string must be non-empty and no more than **2,000 characters**. An embedding array may contain 1 to **24 items**, and every item must satisfy the same bound. Whitespace-only values are rejected. Any ambiguous inference shape also fails closed: chat `messages` cannot be mixed with `text` or `texts`, and a request cannot supply both `text` and legacy `texts`. These are application-level character/item limits rather than a claim that character count equals the provider's token limit.

A missing, malformed, retired or currently unapproved chat-model ID resolves to the reviewed GLM fallback. The former `@cf/meta/llama-3.2-3b-instruct` and `@cf/meta/llama-3-8b-instruct` chat fallbacks are retired. An unapproved embedding model resolves to the reviewed BGE embedding model instead of being redirected through the chat model.

Workers AI calls remain bounded by a 20-second runtime timeout. The chat boundary also normalises supported OpenAI-style `choices[0].message.content` output into the stable legacy `response` field, while embedding responses pass through unchanged.

The historical router still computes its configured output allowance as `maxTokens` and internally supplies `max_tokens`. The active runtime boundary removes that deprecated provider field and sends the same admitted value as `max_completion_tokens` instead. Every chat provider call has an explicit completion cap:

- reviewed EVAVO seed: **320** completion tokens;
- missing internal completion limit: explicit **512**-token fallback;
- absolute admitted maximum: **1,024** completion tokens.

Invalid, non-integer, zero, negative, oversized or conflicting legacy/current completion fields fail closed before provider execution. This compatibility layer applies only to chat inference and does not alter embedding requests.

The answer-quality policy applies only to chat generation. It remains inside the existing 30,000-character system and 75,000-character total-input ceilings; older history is reduced before those ceilings can be exceeded.

The fallback does not rewrite KV. Resave old records through the current admin console, or apply the reviewed EVAVO seed through the explicit post-deploy procedure below, so stored configuration truthfully describes runtime behaviour. Do not add a new model merely because its `@cf/...` identifier is syntactically valid; it must be reviewed and admitted in `worker/src/runtime.ts`, `worker/scripts/check-chat-model-policy-v2.mjs` and `docs/chat-model-policy.md` together.

## 9. EVAVO Workers AI cost envelope

`worker/upsert-evavo.json` deliberately keeps the public EVAVO bot well inside a conservative reviewed model envelope:

- `maxTokens`: 320;
- `maxRequestsPerDay`: 45;
- `maxTokensPerDay`: 45,000 total chat tokens;
- `ragMode`: `simple`.

The dated provider-rate calculation and its executable guard live in `docs/evavo-workers-ai-free-tier-envelope.md` and `worker/scripts/check-evavo-seed-policy.mjs`.

The 45,000-token budget is an internal chat guard, not Cloudflare's billing unit. The reviewed pessimistic calculation treats all 45,000 tokens as though they were charged at GLM-4.7-Flash's more expensive output rate and keeps the EVAVO bot under a 2,000-neuron/day reviewed envelope. This is deliberately conservative.

Do **not** treat that as an account-wide billing guarantee. Workers AI allocation is shared with other account activity and provider pricing or plan availability can change. Re-review current Cloudflare pricing before increasing model or traffic limits.

## 10. Knowledge-cache behaviour

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

## 11. Verify explicit visitor-approved follow-up

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

## 12. Configure production Worker variables

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

## 13. Confirm bindings

`worker/wrangler.jsonc` declares:

```text
AI
BOT_CONFIG
KB_CACHE
```

The namespace IDs are binding identifiers, not bearer credentials. Do not recreate or replace the production namespaces during a routine source release.

## 14. Deploy through the guarded npm lifecycle

```powershell
cd C:\GitRepos\client-chat-platform
cmd /c "npm run deploy"
```

The root deploy command delegates to `npm --prefix worker run deploy`. npm then runs the worker package's `predeploy` hook, which reruns the complete source, configuration, security, portable-widget/model-policy/SUPER EVA, TypeScript and bundle chain before the worker package invokes Wrangler.

Direct Wrangler invocation bypasses the worker npm `predeploy` gate. Do not use direct `wrangler deploy` for a normal release.

A Worker code deployment does **not** automatically rewrite the `evavo` bot configuration in KV and does not refresh approved source caches. That separation is intentional.

## 15. Verify the deployed runtime

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

## 16. Apply and verify the reviewed EVAVO seed

Run this only **after** the deployed Worker has passed the runtime verification above.

The source release and bot-config mutation are intentionally separate. `npm run deploy` must never invoke this operation automatically.

From the repository root:

```powershell
cd C:\GitRepos\client-chat-platform
$env:EVAVO_CHAT_WORKER_URL = "https://<reviewed-worker-host>"
$env:EVAVO_CHAT_ADMIN_TOKEN = "<current-admin-token>"
$env:EVAVO_CHAT_APPLY_SEED_CONFIRM = "APPLY_EVAVO_REVIEWED_SEED"
cmd /c "npm run apply:evavo-seed"
Remove-Item Env:EVAVO_CHAT_ADMIN_TOKEN
Remove-Item Env:EVAVO_CHAT_APPLY_SEED_CONFIRM
Remove-Item Env:EVAVO_CHAT_WORKER_URL
```

The helper is intentionally fail-closed. Before mutation it requires:

- an HTTPS Worker origin, except HTTP localhost/127.0.0.1 for local testing;
- no target URL credentials, query string, fragment or path;
- an administrator token supplied only through the process environment;
- exact confirmation `APPLY_EVAVO_REVIEWED_SEED`;
- HTTP `200` `/health`;
- `securityContract: client_chat_hardened_router_v2`;
- `X-EVAVO-Chat-Runtime: client_chat_active_runtime_v2`.

It then performs only this reviewed sequence:

1. `POST /admin/upsert` with `worker/upsert-evavo.json`;
2. `POST /admin/get` to verify the redacted committed projection;
3. `POST /admin/kb/refresh` for the approved EVAVO sources.

Each operation has one 20-second deadline covering headers **and** the bounded streamed response body, with a 128 KiB response maximum. The helper fails if the stored projection does not match the reviewed model/limits/origins/knowledge/actions, if a bot key is exposed, or if even one approved knowledge URL fails to refresh.

The helper does not print the administrator token or the full returned configuration. Its comparison failures use stable error codes rather than dumping configuration objects.

Successful output should report:

- active runtime `client_chat_active_runtime_v2`;
- reviewed model `@cf/zai-org/glm-4.7-flash`;
- 320 completion-token EVAVO limit;
- 45-request daily EVAVO limit;
- all approved knowledge sources refreshed.

Remove the administrator token and confirmation environment variables immediately after the command as shown above.

## 17. Smoke-test the reviewed EVAVO chat

After seed application, send a non-sensitive prompt from an approved browser origin or an equivalent test harness that supplies the exact approved `Origin` header.

Recommended prompts cover the boundaries we care about:

```text
What does EVAVO specialise in?
Can you show me some of your work?
What would a website cost and how long would it take?
Can you save my details for follow-up?
```

Confirm:

- the response is non-empty and specific;
- factual links come only from reviewed EVAVO sources/configuration;
- no invented price, date, policy, SLA, certification or client fact appears;
- the assistant does not claim visitor data was saved or sent merely because it generated text;
- any follow-up proposal still requires the separate visitor-controlled consent action;
- the response carries `X-EVAVO-Chat-Runtime: client_chat_active_runtime_v2`;
- no raw model identifier or administrator configuration is returned.

Do not use this smoke test to create a real lead unless explicitly testing the separate consent route with disposable test evidence.

## 18. Embed the current widget

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

## 19. Operational limitations and incidents

Workers KV is eventually consistent. Current rate limits, daily budgets and lead indexes reduce cost and abuse but are not strict transactional quotas. Concurrent requests can temporarily exceed a counter, and concurrent index writes can race. Use a Durable Object or another transactional coordinator before treating these values as billing, compliance or high-assurance security controls.

When a credential may have entered source control:

1. revoke or rotate it immediately;
2. do not rely on `.gitignore` as remediation;
3. inspect Git history and build logs;
4. remove tracked material with an intentional history-remediation plan;
5. rerun `npm run check`;
6. verify the deployed Worker uses the rotated value.

When a bot configuration is unsafe, do not weaken the runtime to make it load. Resave it through the reviewed schema, refresh approved knowledge, and verify chat and visitor consent from every exact production origin.