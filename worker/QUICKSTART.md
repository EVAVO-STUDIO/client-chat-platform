# Client Chat Platform — Worker Quickstart

This directory contains the hardened Cloudflare Worker used by `client-chat-platform`.

The active deployed entrypoint is `src/runtime.ts`. It wraps the hardened router and legacy compatibility implementation; do not point Wrangler directly at `src/hardened.ts` or `src/index.ts`.

For the full release procedure, use [`../DEPLOY.md`](../DEPLOY.md).

## Wrangler configuration

This repository uses one Worker config file:

```text
worker/wrangler.jsonc
```

The worker package commands are:

```powershell
cd C:\GitRepos\client-chat-platform\worker
cmd /c "npm run dev"
cmd /c "npm run check"
```

Normal production deployment should be started from the repository root:

```powershell
cd C:\GitRepos\client-chat-platform
cmd /c "npm run deploy"
```

The root command delegates to the worker package. npm runs the worker package's `predeploy` hook (`npm run check`) before Wrangler can publish anything. Do not use a direct `wrangler deploy` command for a routine release.

A Worker code deployment does **not** apply `worker/upsert-evavo.json` to production KV and does not refresh approved knowledge. That mutation remains a separate explicit post-deploy operation:

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

Run that only after the deployed runtime has passed its health checks. `npm run deploy` must never invoke the seed-apply command automatically. The apply helper verifies the hardened runtime, saves the reviewed redacted configuration, reads it back, refreshes all approved sources, and fails on partial refresh. See `../DEPLOY.md` for the complete procedure.

## Local administrator variables

Create an ignored local variable file from the reviewed template:

```powershell
cd C:\GitRepos\client-chat-platform\worker
Copy-Item ..\.dev.vars.example .\.dev.vars
```

Set a random server-only administrator token of 32–256 bytes with no whitespace. Never commit `.dev.vars`.

For production, `ADMIN_TOKEN` is a Wrangler secret. `ADMIN_ALLOWED_ORIGINS` may contain exact hosted admin-console origins. The browser widget never receives the administrator token.

## Current inference policy

Public chat generation is server-owned and currently uses the reviewed model:

```text
@cf/zai-org/glm-4.7-flash
```

Semantic retrieval uses the separately reviewed embedding model:

```text
@cf/baai/bge-base-en-v1.5
```

The administrator console displays the chat model as read-only. Do not add arbitrary model identifiers to bot configuration. Missing, retired or unapproved model values cannot redirect execution outside the reviewed runtime allowlists.

Every chat provider call also has an explicit bounded completion limit. The reviewed EVAVO configuration uses 320 completion tokens; an unexpected missing internal limit receives the runtime's explicit 512-token fallback; and no admitted value may exceed 1,024. The active model boundary sends Cloudflare's current `max_completion_tokens` field rather than the legacy provider field.

## Start locally

```powershell
cd C:\GitRepos\client-chat-platform\worker
cmd /c "npm run dev"
```

Wrangler normally exposes the Worker at:

```text
http://127.0.0.1:8787
```

Check the runtime:

```powershell
curl.exe -i http://127.0.0.1:8787/health
```

Expect HTTP `200` and:

```text
X-EVAVO-Chat-Runtime: client_chat_active_runtime_v2
```

## Administrator requests

PowerShell does not have a `POST /path` shortcut. This helper sends exact Bearer-authenticated JSON requests:

```powershell
$BASE  = "http://127.0.0.1:8787"
$ADMIN = Read-Host "ADMIN_TOKEN"

function Admin-PostJson($Path, $Body) {
  $json = ($Body | ConvertTo-Json -Depth 20 -Compress)
  Invoke-RestMethod "$BASE$Path" -Method POST `
    -Headers @{ Authorization = "Bearer $ADMIN" } `
    -ContentType "application/json" `
    -Body $json
}
```

List configured bot IDs:

```powershell
Admin-PostJson "/admin/list" @{}
```

Load one bot:

```powershell
Admin-PostJson "/admin/get" @{ botId = "evavo" }
```

## Reviewed configuration example

Use only current schema fields. Browser origins are exact; wildcards are rejected. Knowledge URLs must be public HTTPS URLs and are fetched only through authenticated cache refresh.

```powershell
Admin-PostJson "/admin/upsert" @{
  botId = "evavo"
  siteName = "EVAVO Studio"
  contactUrl = "/contact"
  allowedOrigins = @(
    "https://evavo.com.au",
    "https://www.evavo.com.au",
    "http://localhost:3000"
  )
  tone = "Calm, concise, practical and specific. Do not invent pricing, timelines, policies or guarantees."
  leadMode = "balanced"
  qualifyingQuestions = @(
    "What are you trying to build?",
    "Who is it for?",
    "What timing and active budget context are you working with?"
  )
  knowledge = "Approved operator-maintained facts and limitations for this bot."
  knowledgeUrls = @(
    "https://evavo.com.au/services"
  )
  ragEnabled = $true
  ragMaxUrlsPerRequest = 1
  ragCacheTtlSeconds = 86400
  model = "@cf/zai-org/glm-4.7-flash"
  maxTokens = 320
  maxTurns = 8
  maxCharsPerMessage = 1400
  rateLimit = @{
    limit = 5
    windowSeconds = 60
  }
  dailyBudget = @{
    maxRequestsPerDay = 45
    maxTokensPerDay = 45000
  }
  actions = @{
    actionsEnabled = $true
    allowedActionTypes = @("open_contact", "create_lead")
  }
}
```

The protected configuration boundary canonicalizes the stored/admin-projected chat model to the reviewed GLM model. A blank bot key preserves an existing key after load; use the reviewed admin console when rotating or explicitly clearing a bot key.

## Refresh approved knowledge

Public `/api/chat` requests never fetch configured source pages live. Refresh approved public sources through the authenticated route:

```powershell
Admin-PostJson "/admin/kb/refresh" @{ botId = "evavo" }
```

The refresh path validates public HTTPS destinations and redirects, applies bounded time/byte limits, rejects binary-looking content and writes digest-verified cache records.

## Chat request

The hardened public request contract uses a bounded `messages` array:

```powershell
$payload = @{
  botId = "evavo"
  messages = @(
    @{
      role = "user"
      content = "How do you stop an AI assistant inventing pricing or policies?"
    }
  )
} | ConvertTo-Json -Depth 10 -Compress

Invoke-RestMethod "$BASE/api/chat" `
  -Method POST `
  -Headers @{ Origin = "http://localhost:3000" } `
  -ContentType "application/json" `
  -Body $payload
```

The page origin must be present in the bot's exact `allowedOrigins` list. Public requests must not contain administrator credentials or a public HTML bot key.

The historical single `message` request shape is not part of the hardened public contract.

## Visitor-approved follow-up

A model action cannot directly store a lead during `/api/chat`. `create_lead` is only a proposal that the widget may present to the visitor.

A lead record is written only after the visitor reviews the exact email/message evidence and explicitly chooses **Share for follow-up**, which sends a separate `POST /api/leads` request with `consent: true`.

The evidence is verified but not stored. Explicit lead records and their index expire after 90 days.

See [`../DEPLOY.md`](../DEPLOY.md) for the complete lead-consent verification command and production release checklist.
