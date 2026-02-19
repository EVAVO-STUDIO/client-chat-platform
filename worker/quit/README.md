# Client Chat Platform (Cloudflare Worker)

Multi-tenant website chat endpoint backed by **Cloudflare Workers AI** and **KV**.

## Endpoints

- `GET /health`
- `GET /bot/:botId` (public, safe config for frontend)
- `POST /api/chat` (public)
- `POST /admin/upsert` (auth)
- `POST /admin/get` (auth)
- `POST /admin/delete` (auth)
- `GET /admin/list` (auth)

## Setup

1) Create KV namespace (once):

```bash
npx wrangler kv namespace create BOT_CONFIG
```

2) Put the returned KV namespace **id** into `wrangler.jsonc` (`kv_namespaces[0].id`).

3) Set an admin token secret:

```bash
npx wrangler secret put ADMIN_TOKEN
```

4) Deploy:

```bash
npx wrangler deploy
```

## Admin: upsert bot config (PowerShell example)

```powershell
$api   = "https://YOUR-WORKER.your-account.workers.dev"
$token = Read-Host "ADMIN_TOKEN"
$headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

$body = @{
  botId = "digital-safegrid"
  siteName = "Digital SafeGrid"
  contactUrl = "https://digital-safegrid.com/contact"
  tone = "premium, calm, concise, high-trust"
  greeting = "Hi — I can help with rack space, power, security, and onboarding. What are you looking to achieve?"
  brandHex = "#00e589"
  mode = "sales"
  leadMode = "balanced"
  qualifyingQuestions = @(
    "Where are you located (city/country)?",
    "How many racks or RU do you need?",
    "Any power requirement per rack (kW)?",
    "When do you need this live?"
  )
  allowedOrigins = @(
    "https://digital-safegrid.com",
    "https://www.digital-safegrid.com"
  )

  # Keep the bot scoped to what you feed it
  guardrails = @{
    knowledgeOnly = $false
    disallow = @("passwords", "credit card")
  }

  # Optional: inject a short curated FAQ / product notes
  knowledge = @{
    mode = "static"
    text = "(paste a short FAQ / offer summary here)"
    maxChars = 12000
  }

  # Optional: usage limits
  budget = @{
    enabled = $true
    perMinute = 12
    perDay = 250
    perMonth = 6000
    mode = "free_then_cap"
    freeDailyRequests = 60
    maxDailyRequests = 200
    maxInputChars = 12000
    maxOutputChars = 8000
    blockMessage = "Thanks — we've hit today's chat limit. Please use the contact page for next steps."
  }

  model = @{
    model = "@cf/meta/llama-3-8b-instruct"
    temperature = 0.4
    maxTokens = 450
  }
} | ConvertTo-Json -Depth 12

Invoke-RestMethod -Method Post -Uri "$api/admin/upsert" -Headers $headers -Body $body
```

## Public: chat test (PowerShell example)

```powershell
$api = "https://YOUR-WORKER.your-account.workers.dev"
$headers = @{ "Content-Type" = "application/json"; "Origin" = "https://digital-safegrid.com" }

$body = @{
  botId = "digital-safegrid"
  messages = @(
    @{ role = "user"; content = "I’m in Melbourne. Need 1 rack, ~3kW. Lead time + pricing ballpark?" }
  )
} | ConvertTo-Json -Depth 8

Invoke-RestMethod -Method Post -Uri "$api/api/chat" -Headers $headers -Body $body
```
