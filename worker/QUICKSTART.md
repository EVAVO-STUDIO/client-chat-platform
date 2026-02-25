# Client Chat Platform — Worker Quickstart

This worker is a multi-tenant chatbot backend.

## Config file: wrangler.jsonc

This repo uses **wrangler.jsonc** (JSONC). Scripts in `package.json` run:

- `npm run dev` → `wrangler dev -c wrangler.jsonc`
- `npm run deploy` → `wrangler deploy -c wrangler.jsonc`

To avoid confusion, keep **one** Wrangler config file. (This repo intentionally does **not** use `wrangler.toml`.)

## Secrets (ADMIN + optional)

Set your admin token (required for /admin/*):

```powershell
npx wrangler secret put ADMIN_TOKEN -c wrangler.jsonc
```

(Optional) If you want to require a bot key for /api/chat per-bot, set `botKey` in that bot's config.

## Admin endpoints (PowerShell)

> PowerShell does **not** have a `POST /path` shortcut. Use `irm` (Invoke-RestMethod).

```powershell
$BASE  = "http://127.0.0.1:8787"  # wrangler dev default
$ADMIN = Read-Host "ADMIN_TOKEN"

function Admin-PostJson($Path, $Body) {
  $json = ($Body | ConvertTo-Json -Depth 50)
  irm "$BASE$Path" -Method POST `
    -Headers @{ Authorization = "Bearer $ADMIN" } `
    -ContentType "application/json" `
    -Body $json
}

# List bot ids
Admin-PostJson "/admin/list" @{}

# Upsert a bot config
Admin-PostJson "/admin/upsert" @{
  botId = "digitalsafegrid"
  name  = "Digital SafeGrid Assistant"
  allowedOrigins = @(
    "https://digitalsafegrid.com",
    "https://www.digitalsafegrid.com",
    "http://localhost:3000"
  )
  dailyBudget = @{ limit = 300 }          # requests/day (hard stop)
  rateLimit   = @{ windowSeconds = 60; limit = 20 } # requests/min per IP
  maxTokens   = 450
  temperature = 0.35
  systemPrompt = @"
You are the Digital SafeGrid website assistant.

Rules:
- Do NOT invent pricing, SLAs, guarantees, availability, or supplier commitments.
- Ask 1–3 clarifying questions when needed.
- Keep answers short and practical.
- End with a CTA to contact/book a call.
"@
}

# Get a bot config (supports loose matching e.g. digital-safegrid vs digitalsafegrid)
Admin-PostJson "/admin/get" @{ botId = "digitalsafegrid" }

# Refresh KB (pulls + caches content for this bot)
Admin-PostJson "/admin/kb/refresh" @{ botId = "digitalsafegrid" }

# Leads saved from create_lead actions
Admin-PostJson "/admin/leads/list" @{ botId = "digitalsafegrid" }
```

## Chat endpoint (PowerShell)

New format:

```powershell
$payload = @{
  botId = "digitalsafegrid"
  messages = @(
    @{ role = "user"; content = "What do you do, and what info do you need to give me options?" }
  )
} | ConvertTo-Json -Depth 50

irm "$BASE/api/chat" -Method POST -ContentType "application/json" -Body $payload
```

Legacy format is also supported:

```powershell
$payload = @{
  botId = "digitalsafegrid"
  message = "What do you do, and what info do you need?"
} | ConvertTo-Json -Depth 50

irm "$BASE/api/chat" -Method POST -ContentType "application/json" -Body $payload
```
