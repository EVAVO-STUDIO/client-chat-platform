# Client Chat Platform deployment runbook

This is the authoritative Windows PowerShell procedure for validating, migrating and deploying the hardened Cloudflare Worker.

Commands use `cmd /c` where useful to avoid PowerShell `npm.ps1` execution-policy problems.

## Runtime being deployed

Wrangler deploys:

```text
worker/src/runtime.ts
```

The runtime removes retired request aliases and normalises model selection before delegating to:

```text
worker/src/hardened.ts
```

The historical implementation remains behind that boundary in:

```text
worker/src/index.ts
```

Do not point Wrangler directly at either compatibility module.

## 1. Prerequisites

- Node.js 24.
- Git.
- A Cloudflare account with access to the existing Worker, Workers AI and both configured KV namespaces.
- The repository at `C:\GitRepos\client-chat-platform`.
- The current Worker administrator token, or authority to rotate it.

Confirm local tools:

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

Use `npm ci`, not `npm install`, for validation and deployment. It must reproduce `worker/package-lock.json` exactly.

## 3. Configure local-only Worker variables

```powershell
cd C:\GitRepos\client-chat-platform\worker
Copy-Item ..\.dev.vars.example .\.dev.vars
notepad .\.dev.vars
```

Replace:

```text
ADMIN_TOKEN=replace_me_with_a_random_server_only_token
```

with a random 32–256 byte value containing no whitespace.

`.dev.vars` is ignored and must never be committed. `ADMIN_ALLOWED_ORIGINS` is optional for local development because localhost and `127.0.0.1` admin origins are already accepted by the runtime.

## 4. Run the complete predeployment gate

```powershell
cd C:\GitRepos\client-chat-platform\worker
cmd /c "npm run check"
```

The order is mandatory:

1. tracked-source secret scan;
2. deterministic security architecture contract;
3. TypeScript validation of the active entrypoint.

Do not continue after any failure.

## 5. Start the Worker locally

```powershell
cd C:\GitRepos\client-chat-platform\worker
cmd /c "npm run dev"
```

Wrangler normally exposes the local Worker at:

```text
http://localhost:8787
```

In another PowerShell window:

```powershell
curl.exe -i http://localhost:8787/health
```

Expected characteristics:

- HTTP `200`;
- JSON with `ok: true`;
- `securityContract: client_chat_hardened_router_v2`;
- `publicChatNetworkFetch: false`;
- `externalWebhookExecution: false`;
- response header `X-EVAVO-Chat-Runtime: client_chat_active_runtime_v1`.

The health response must not reveal whether `ADMIN_TOKEN` is configured.

## 6. Open the reviewed admin console locally

```powershell
cd C:\GitRepos\client-chat-platform\admin
cmd /c "npx --yes http-server . -p 4173"
```

Open:

```text
http://localhost:4173
```

Use:

```text
Worker API origin: http://localhost:8787
Admin token: the value in worker/.dev.vars
```

The page does not persist the token. Closing or refreshing the tab clears it.

## 7. Review every legacy bot before production activation

The hardened runtime fails closed when a stored bot contains unsafe network or action configuration.

A legacy bot must be loaded, reviewed and resaved when it has any of the following:

- no browser origin list;
- wildcard origins;
- non-HTTPS production origins;
- origins with paths, credentials, query strings or fragments;
- non-public or non-HTTPS knowledge URLs;
- webhook URL, webhook authentication or webhook secret fields;
- an invalid bot key;
- obsolete lead mode values;
- unbounded or malformed numeric settings.

For each bot:

1. Enter its Bot ID.
2. Select **Load bot**.
3. Add every exact public website origin that may host the widget.
4. Remove any obsolete wildcard entry.
5. Review the contact URL, curated knowledge and public knowledge URLs.
6. Keep external webhook execution disabled.
7. Select **Save reviewed configuration**.
8. Select **Refresh approved cache**.
9. Inspect the sanitised result for `refreshed`, `failed` and `cacheVersion`.

The current configuration writer stores schema version 4 and discards unsafe legacy fields rather than silently preserving them.

## 8. Model migration posture

The final runtime uses:

```text
@cf/meta/llama-3.2-3b-instruct
```

when a bot record has:

- no model;
- a malformed model identifier;
- the known-retired `@cf/meta/llama-3-8b-instruct` identifier.

This fallback keeps old records operable without trusting malformed configuration. The fallback does not rewrite KV. Resave each bot through the current admin console so its stored model accurately describes runtime behaviour.

The optional helper remains available for deliberate EVAVO bot updates:

```powershell
cd C:\GitRepos\client-chat-platform\worker
$env:WORKER_URL="https://client-chat-platform.example.workers.dev"
$env:ADMIN_TOKEN="<current Worker ADMIN_TOKEN>"
$env:BOT_ID="evavo"
$env:MODEL="@cf/meta/llama-3.2-3b-instruct"
cmd /c "node scripts/update-evavo-model.mjs"
```

Do not place the token in source files, shell-history screenshots or issue comments.

## 9. Knowledge cache behaviour

Public chat never fetches source pages during a visitor request.

Only authenticated:

```text
POST /admin/kb/refresh
```

may fetch configured knowledge URLs.

The refresh boundary:

- accepts public HTTPS only;
- validates every redirect manually;
- keeps one timeout across redirects, headers and body streaming;
- limits response bytes;
- rejects binary-looking bodies;
- strips HTML to bounded text;
- stores source URL, final URL, fetch time, source bytes and a verified text digest;
- uses a 70-byte SHA-256-derived KV key instead of the raw URL.

Command-line refresh example:

```powershell
$WorkerUrl = "https://client-chat-platform.example.workers.dev"
$AdminToken = "<current Worker ADMIN_TOKEN>"
$Body = '{"botId":"evavo"}'

curl.exe -i -X POST "$WorkerUrl/admin/kb/refresh" `
  -H "Authorization: Bearer $AdminToken" `
  -H "Content-Type: application/json" `
  --data-binary $Body
```

A partial refresh is reported honestly. Failed sources are not replaced with invented or stale text by the refresh operation.

## 10. Configure the production administrator credential

Authenticate Wrangler:

```powershell
cd C:\GitRepos\client-chat-platform\worker
cmd /c "npx wrangler login"
cmd /c "npm run whoami"
```

Set or rotate the server-only token:

```powershell
cmd /c "npx wrangler secret put ADMIN_TOKEN -c wrangler.jsonc"
```

Use a random 32–256 byte value without whitespace.

For a hosted admin console, configure `ADMIN_ALLOWED_ORIGINS` as a comma-separated list of exact origins. It may be stored as a Cloudflare secret even though the origin list is not confidential:

```powershell
cmd /c "npx wrangler secret put ADMIN_ALLOWED_ORIGINS -c wrangler.jsonc"
```

Example prompted value:

```text
https://ops.example.com,https://admin.example.com
```

Do not add production environment values to `wrangler.jsonc` or any tracked file.

## 11. Confirm KV and Workers AI bindings

`worker/wrangler.jsonc` already declares:

```text
AI
BOT_CONFIG
KB_CACHE
```

The namespace IDs are deployment bindings, not bearer credentials. Do not recreate or replace the existing production namespaces during a routine source deployment.

When intentionally moving the Worker to a different Cloudflare account, create replacement namespaces first, update both IDs deliberately, migrate required configuration records and repeat the full review process before exposing public chat.

## 12. Deploy through the guarded npm lifecycle

From the repository root:

```powershell
cd C:\GitRepos\client-chat-platform
cmd /c "npm run deploy"
```

The root command delegates to the Worker package. Its `predeploy` hook reruns the complete check before Wrangler uploads anything.

Do not use direct:

```text
wrangler deploy
```

for a normal release. Direct Wrangler invocation bypasses the npm `predeploy` gate.

## 13. Verify the deployed runtime

Set the deployed origin:

```powershell
$WorkerUrl = "https://client-chat-platform.example.workers.dev"
```

### Health

```powershell
curl.exe -i "$WorkerUrl/health"
```

Confirm:

- HTTP `200`;
- `X-EVAVO-Chat-Runtime: client_chat_active_runtime_v1`;
- no administrator configuration disclosure;
- no raw model or provider information.

### Retired admin-header alias is denied

```powershell
curl.exe -i -X POST "$WorkerUrl/admin/list" `
  -H "x-admin-token: invalid-placeholder-value-that-is-not-authoritative"
```

Expected: HTTP `401`. The retired header must never authenticate a request.

### Exact Bearer administration

```powershell
$AdminToken = "<current Worker ADMIN_TOKEN>"

curl.exe -i -X POST "$WorkerUrl/admin/list" `
  -H "Authorization: Bearer $AdminToken"
```

Expected: HTTP `200` with a bounded JSON bot-ID list.

### Unsafe method handling

```powershell
curl.exe -i "$WorkerUrl/admin/list"
curl.exe -i "$WorkerUrl/api/chat"
```

Expected: HTTP `405` with the correct `Allow` header.

### Public browser chat

Use the actual approved website origin and the current widget. Confirm:

- the panel opens and closes by keyboard;
- Escape closes the dialog;
- focus remains inside the open dialog;
- a bounded user message receives a response;
- an unapproved origin receives no readable chat response;
- raw provider output is absent;
- contact actions navigate only to the reviewed contact path;
- no bot key appears in page source or network request JSON.

## 14. Embed the current widget

Host `widget/embed.js` on an approved static origin and add:

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

The browser widget is authorised by the exact page origin stored in the bot configuration. Never add the optional server bot key to public HTML.

A strict host Content Security Policy may pass its style nonce through:

```html
<script
  nonce="<server-generated-nonce>"
  data-style-nonce="<server-generated-nonce>"
  ...
></script>
```

The nonce must be generated by the host application for each response. Do not hard-code it.

## 15. Operational limitations

Workers KV counters and indexes are eventually consistent. Current rate limits, daily budgets and lead indexes reduce cost and abuse but are not strict transactional quotas. Concurrent requests can temporarily exceed a configured counter, and concurrent index writes can race.

Use a Durable Object or another transactional coordinator before treating these values as billing, compliance or high-assurance security controls.

## 16. Incident handling

When a credential may have entered source control:

1. revoke or rotate it immediately;
2. do not rely on `.gitignore` as remediation;
3. inspect Git history and build logs;
4. remove the tracked material with an intentional history-remediation plan;
5. rerun `npm run check`;
6. verify the deployed Worker uses the rotated value.

When a bot configuration is unsafe:

1. do not weaken the runtime to make it load;
2. load it through authenticated administration;
3. resave it through the reviewed schema;
4. refresh approved knowledge;
5. verify public chat from every exact production origin.
