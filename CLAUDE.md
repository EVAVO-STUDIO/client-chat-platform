# Claude Contract for Client Chat Platform

Read `AGENTS.md`, `evavo.reliability.json`, `README.md`, `DEPLOY.md` and `docs/security-boundary.md` before acting.

Use the repository only for the active Cloudflare Worker, isolated widget and bounded admin console. Work on `main`, preserve unrelated work and publish through Development Studio `mainline-publish` with an explicit portfolio operation and exact changed paths. Do not create branches, pull requests, repositories or ungoverned provider changes.

Run the committed chain:

```powershell
npm --prefix worker ci --no-audit --no-fund
npm --prefix worker run check
```

Never expose or infer `ADMIN_TOKEN`, bot keys or retired webhook credentials. Do not weaken exact-origin, request-bound, SSRF, storage, consent or privacy controls. A Wrangler dry run is not a Cloudflare deployment. Production deployment, KV mutation, resource changes and secret changes require separate reviewed authority and retained provider evidence.
