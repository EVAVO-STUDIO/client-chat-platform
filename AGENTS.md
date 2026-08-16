# Client Chat Platform Agent Contract

This repository is the active EVAVO commercial slot for one hardened, reusable Cloudflare Worker and isolated browser chat widget. Read `evavo.reliability.json`, `README.md`, `DEPLOY.md` and `docs/security-boundary.md` before changing source.

## Portfolio and publication

- Feature work is allowed only while Development Studio keeps this repository in an active commercial slot.
- Automated publication uses Development Studio `pnpm mainline-publish` with `--operation feature` or `--operation maintenance`, the exact repository path, a coherent message and every changed file named by `--path`.
- Work directly on `main`; do not create branches or pull requests for automated work.
- Require `repository-main:EVAVO-STUDIO/client-chat-platform`, a clean current `main`, the committed validation profile and no remote-head drift.
- Never force-push, broadly stage, bypass hooks or fall back to raw GitHub contents writes when the governed publisher is unavailable.

## Required validation

```powershell
npm --prefix worker ci --no-audit --no-fund
npm --prefix worker run check
```

The check chain must retain source-secret, admin-config-secret, runtime-storage, security, Super EVA widget and presentation, TypeScript and Wrangler dry-run bundle verification. Do not replace it with a generic build command.

## Security and privacy boundaries

- `ADMIN_TOKEN` remains a Worker secret and must never appear in tracked source, the widget, logs or evidence.
- Browser chat requires exact approved origins. Wildcards are prohibited.
- Public chat must not fetch knowledge URLs live.
- A model action may propose follow-up but cannot create a lead during chat. The explicit lead route requires visitor consent and visitor-authored evidence.
- Raw IP addresses and user-agent strings must not be stored.
- Workers KV coordination is best-effort. Do not claim transactional rate limits, counters or lead indexes.
- Cloudflare resource creation, deletion, binding changes, production KV mutation and deployment require separate reviewed authority.

## Truth boundary

A passing source check and Wrangler dry run prove the active module graph and configuration can bundle. They do not prove a live deployment, configured production bot, exact production origin, Workers AI response, widget integration or rollback. Production completion requires separately retained deployment, health, browser and rollback evidence.
