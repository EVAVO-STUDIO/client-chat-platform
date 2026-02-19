# Deploy guide (PowerShell / Windows)

These commands avoid PowerShell's `npm.ps1` execution-policy issues by running Node tools through `cmd /c`.

## 1) Prereqs
- Node.js LTS installed
- A Cloudflare account
- `wrangler` will be installed locally by `npm install`

## 2) Install worker deps
```powershell
cd .\worker
cmd /c "npm install"
```

## 3) Login to Cloudflare
```powershell
cmd /c "npx wrangler login"
```

## 4) Create KV namespace (once per account)
```powershell
cmd /c "npx wrangler kv namespace create BOT_CONFIG"
```
Copy the `id` it outputs and paste it into `worker/wrangler.jsonc` under `kv_namespaces[0].id`.

## 5) Set admin token secret (required)
Choose a long random string.
```powershell
cd .\worker
cmd /c "npx wrangler secret put ADMIN_TOKEN"
```

## 6) Deploy Worker
```powershell
cd .\worker
cmd /c "npx wrangler deploy"
```
Copy the deployed URL (e.g. `https://client-chat-platform.<your-subdomain>.workers.dev`).

## 7) Open Admin UI locally (or host it)
Option A (local preview using any static server):
```powershell
cd ..\admin
cmd /c "npx --yes http-server . -p 4173"
```
Then open: http://localhost:4173

In Admin UI:
- API Base: your Worker URL
- Admin Token: the secret you set
- Create/Update bot config

### Bot training / customization (practical)

You have 3 layers of "knowledge":

1) **Curated "knowledge" text** (best first step): paste FAQ/policies/offers into the bot config. This is reliable.
2) **knowledgeUrls + ragEnabled**: the worker can fetch a small set of static HTML pages and cache the text for 24h.
3) **Full RAG pipeline (Vectorize)**: best for larger sites and frequent updates (recommended if you sell this broadly).

For Digital SafeGrid, start with (1) + (2).

Example config fields to set in Admin UI:
- knowledge: paste curated FAQ/policies
- knowledgeUrls: list key pages (Services, Pricing, FAQ, Contact)
- ragEnabled: true
- ragMaxUrlsPerRequest: 2

#### Refresh URL cache

After you change the website content, refresh the worker cache:

```powershell
$WORKER_URL = "https://client-chat-platform.evavo-studio.workers.dev"
$ADMIN_TOKEN = "<your token>"

curl -X POST "$WORKER_URL/admin/kb/refresh" `
  -H "Authorization: Bearer $ADMIN_TOKEN" `
  -H "Content-Type: application/json" `
  -d '{"botId":"digital-safegrid"}'
```

> Note: `knowledgeUrls` uses plain `fetch()` (no JS rendering). For JS-heavy pages, use a build-time ingestion step (Playwright) to extract text and paste it into `knowledge`, or upgrade to Vectorize.

## 8) Add widget to a client website
Host `widget/embed.js` somewhere (Cloudflare Pages is easiest), or copy it to the client site.

Then add:
```html
<script
  src="https://YOUR_STATIC_HOST/embed.js"
  data-api-base="https://YOUR_WORKER_URL"
  data-bot-id="digital-safegrid"
  data-title="Digital SafeGrid"
></script>
```

## 9) Delete the old scaffold folder you made earlier (optional)
If you previously created `client-chat-platform\worker\quit`, delete it after copying this repo in:
```powershell
cd D:\EVAVO\GitRepos
Remove-Item -Recurse -Force .\client-chat-platform
```
Then unzip/copy this fixed repo to `D:\EVAVO\GitRepos\client-chat-platform`.
