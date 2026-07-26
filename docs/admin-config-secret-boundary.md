# Administrator configuration secret boundary

## Purpose

The Client Chat Platform administrator API manages bot configuration in Cloudflare KV. Some historical configurations may contain a server bot key or retired webhook credential fields. Those values are operational secrets and must not be returned to the browser-based administrator console or copied into diagnostic output.

The active boundary is implemented by:

```text
worker/src/runtimeStorageBoundary.ts
client_chat_runtime_storage_boundary_v1
```

It runs outside the legacy compatibility router and applies before configuration writes reach KV and before configuration responses reach the administrator client.

## Bot-key write semantics

A bot key is optional for trusted non-browser clients. Browser chat uses exact Origin allowlists and must not embed a bot key.

For authenticated `POST /admin/upsert` requests:

- a new valid non-empty `botKey` sets or replaces the stored key;
- an omitted or empty `botKey` preserves an existing key;
- a new bot with no existing key remains browser-only;
- clearing a key requires the explicit reserved value:

```text
__EVAVO_CLEAR_BOT_KEY__
```

The reserved value is interpreted by the runtime storage boundary and is never persisted. This prevents a read-edit-write administration workflow from silently deleting a key merely because config reads no longer return the secret.

## Response projection

Successful `/admin/get` and `/admin/upsert` responses are projected before they leave the Worker:

- `botKey` is removed;
- `botKeyConfigured` reports only whether a valid key exists;
- retired webhook URL, authorization-header and secret fields are removed;
- action types are restricted to `open_contact`, `create_lead` and `none`;
- response bodies remain bounded and strict UTF-8 JSON;
- the response remains `Cache-Control: no-store`.

The browser console also redacts secret-shaped fields before displaying response JSON. That client-side redaction is defence in depth, not the authoritative security boundary.

## Retired webhook credentials

External webhook execution is disabled by the active hardened router. When a configuration is next saved, any historical webhook destination, authorization-header or secret fields are removed before the new record reaches KV.

The boundary does not call a webhook, migrate remote records in the background or enumerate existing configuration records. Historical records are cleaned only through an explicitly authenticated operator update.

## Rate-limit identifier privacy

The legacy compatibility engine derives its chat rate-limit key from the bot ID, request window and client address. The active runtime now maps every legacy `rl:` key to:

```text
rl:v2:<sha256>
```

before the key reaches `KB_CACHE`.

This prevents the raw client address from appearing in KV key names. The hash is pseudonymous rather than anonymous, and the KV limiter remains best-effort because Workers KV does not provide a transactional increment primitive. It must not be described as a globally exact abuse-control counter.

## Required verification

Run:

```powershell
cd C:\GitRepos\client-chat-platform\worker
npm run check:config-secrets
npm run check:security
npm run typecheck
npm run check:bundle
```

`npm run check:security` automatically runs the focused config-secret check first through the npm `precheck:security` lifecycle hook. The read-only GitHub Actions workflow runs the same command and does not deploy the Worker or request runtime secrets.

## Explicit non-goals

This boundary does not:

- deploy the Worker;
- read or mutate remote KV during repository checks;
- reveal an existing bot key;
- turn webhook execution back on;
- make Workers KV rate limiting transactional;
- store raw request bodies, administrator tokens or client addresses in audit output.
