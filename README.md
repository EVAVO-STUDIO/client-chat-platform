# Client Chat Platform (Cloudflare Workers + Workers AI + KV)

This repo is a multi-tenant chatbot platform you can reuse across clients.

- **worker/**: Cloudflare Worker API (`/api/chat`, `/admin/*`) using Workers AI + KV.
- **widget/**: Embeddable website chat widget (copy/paste script tag).
- **admin/**: Simple static admin panel to create/update bot configs in KV (protected by an admin token).
- **shared/**: Shared types/schema.

## Cost control (important)
- Uses a small, fast model by default.
- Rate-limits per IP per bot (to help prevent spam and surprise usage).
- You can upgrade models later per bot when needed.

## Quick start (Windows PowerShell)
See `DEPLOY.md`.
