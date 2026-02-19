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
