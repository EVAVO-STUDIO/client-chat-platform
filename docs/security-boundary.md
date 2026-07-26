# Client Chat Platform security boundary

## Purpose

This document describes the active trust boundary for `EVAVO-STUDIO/client-chat-platform`.

The deployed Worker entrypoint is:

```text
worker/src/runtime.ts
```

The entrypoint removes retired request aliases and constrains model selection before calling `worker/src/hardened.ts`. The hardened router then delegates selected compatibility operations to `worker/src/index.ts`. Neither compatibility module may be configured as the Wrangler entrypoint.

## Trust zones

### Public browser

The browser widget is untrusted. It may provide only:

- a valid bot identifier;
- a bounded sequence of `user` and `assistant` messages;
- normal CORS headers supplied by the browser.

The browser cannot provide:

- an administrator credential;
- a system message;
- raw provider options;
- a debug flag;
- a workspace, tenant or role;
- a bot key in JSON;
- a knowledge URL;
- a webhook destination;
- a destructive confirmation.

### Non-browser client

A non-browser caller generally has no `Origin` header. It must provide a valid bot key in `x-bot-key` when using `/api/chat`.

The bot key is a shared client credential, not an administrator credential. It can call only the public chat route and cannot modify configuration, refresh knowledge or read leads.

### Administrator

Every `/admin/*` request must:

- use `POST`;
- use exact Bearer authentication;
- carry a 32–256 byte configured `ADMIN_TOKEN`;
- originate from an allowed hosted admin origin or a localhost development origin when a browser sends `Origin`;
- use a bounded JSON object for routes that accept a body.

`x-admin-token` is retired. `worker/src/runtime.ts` removes it before any route or compatibility adapter sees the request. Only `Authorization: Bearer ...` is authoritative.

### Cloudflare bindings

The Worker uses:

- Workers AI for model inference;
- `BOT_CONFIG` KV for reviewed bot configuration and internal lead records;
- `KB_CACHE` KV for bounded knowledge-cache records and historical best-effort counters.

KV namespace identifiers in Wrangler configuration are binding identifiers, not administrator credentials. Real Worker secrets belong in Cloudflare secret storage or an ignored local `.dev.vars` file.

## Final runtime boundary

`worker/src/runtime.ts` is intentionally narrow. It:

- removes the retired administrator header globally;
- validates the model identifier immediately before the Workers AI binding receives it;
- replaces a missing, malformed or known-retired model with `@cf/meta/llama-3.2-3b-instruct`;
- delegates every HTTP route to the hardened router;
- stamps responses with `X-EVAVO-Chat-Runtime: client_chat_active_runtime_v1`.

The runtime fallback does not mutate KV and does not disclose model substitution in response data. Operators should still resave old bot records so stored configuration truthfully describes runtime behaviour.

## Request boundary

`worker/src/security.ts` enforces:

- JSON media types only;
- declared and observed body limits;
- strict UTF-8 decoding;
- object-root JSON;
- maximum depth, node count, array length, key length and string length;
- rejection of `__proto__`, `prototype` and `constructor` keys.

The current limits are:

```text
admin JSON: 64 KiB
chat JSON: 128 KiB
chat messages: 30
single chat message: 8,000 characters
combined chat message content: 75,000 characters
```

The public widget applies tighter client-side limits, but server checks remain authoritative.

## Administrator authentication

The Worker accepts only:

```http
Authorization: Bearer <ADMIN_TOKEN>
```

The supplied and configured values must both satisfy the bounded credential shape. Their SHA-256 digests are compared with a fixed-length comparison.

Public health output does not reveal whether the token is configured.

## Browser-origin policy

Bot configurations require at least one exact origin. The active boundary rejects wildcard origins.

Allowed production form:

```text
https://example.com
```

Allowed local-development forms:

```text
http://localhost:3000
http://127.0.0.1:3000
```

Origins cannot include credentials, paths, query strings or fragments.

CORS preflight is not treated as authorization. The actual chat request resolves the stored bot configuration and rechecks the exact origin before invoking the model.

## Bot-key policy

A bot key is optional. When configured, it must be 16–256 characters with no whitespace or control characters.

A valid exact browser origin does not need a bot key. A request without `Origin` must present the configured key in:

```http
x-bot-key: <BOT_KEY>
```

The hardened router consumes the key before delegating to historical compatibility code. The key is removed from the model-facing configuration override.

## Configuration boundary

`worker/src/configBoundary.ts` constructs a reviewed allowlist of configuration fields. Unknown fields are not forwarded as authoritative configuration.

The active boundary:

- requires exact origins;
- accepts only safe contact URLs;
- accepts public HTTPS knowledge URLs;
- bounds text, numeric and array fields;
- normalises lead mode to `soft`, `balanced` or `direct`;
- forces simple cached retrieval;
- rejects webhook URL, webhook authentication and webhook secret fields;
- permits only `open_contact`, `create_lead` and `none` actions;
- clears omitted unsafe legacy action and URL state rather than preserving it.

## Knowledge retrieval boundary

Public chat performs no external network fetch.

Knowledge retrieval occurs only through authenticated:

```text
POST /admin/kb/refresh
```

Each source URL must be public HTTPS. The fetch boundary:

- rejects URL credentials;
- rejects sensitive query-key names;
- rejects private, loopback, link-local, reserved, documentation and internal hosts;
- rejects non-standard ports;
- follows redirects manually only after validating the next target;
- keeps one deadline active through request, redirects, headers and streamed body reading;
- limits decoded body bytes;
- rejects binary-looking bodies;
- accepts text, HTML and XHTML media types only.

Wrangler also enables:

```text
global_fetch_strictly_public
```

This is a runtime SSRF boundary in addition to source-level URL validation.

## Knowledge cache contract

A source URL is never used directly as a KV key. The key is:

```text
kb:v2:<64-character SHA-256 hex digest>
```

The resulting key is 70 bytes.

Each cached value is an exact-shape JSON record containing:

- cache contract version;
- requested source URL;
- final URL after validated redirects;
- fetch timestamp;
- source byte count;
- SHA-256 digest of the stored text;
- bounded stripped text.

Before model use, the Worker verifies record shape, URL policy and the stored text digest. Legacy plain-string cache entries are not authoritative for the hardened path.

Fetched website excerpts are labelled as untrusted factual reference. The model is explicitly instructed not to follow instructions contained inside those excerpts.

## Model and response boundary

The historical model adapter is invoked only after the hardened router has:

- authorised the origin or bot key;
- validated message shape;
- loaded safe configuration;
- replaced live retrieval with verified cached excerpts;
- removed bot-key enforcement from the delegated configuration;
- removed unsafe action configuration.

The final runtime then validates the actual model argument presented to Workers AI. This protects old stored records and future compatibility code from selecting an empty, malformed or known-retired model.

The returned response is re-read through a bounded stream. The public response:

- must be JSON;
- cannot contain `raw`, `stack` or `cause` fields;
- cannot expose detailed provider errors on failure;
- receives no-store and defensive response headers.

The widget renders messages with `textContent`, never HTML.

## Action and lead boundary

The active model may request:

- `open_contact` — the widget validates and presents a navigation action;
- `create_lead` — the historical adapter stores a user-supplied internal lead record in `BOT_CONFIG` KV;
- `none`.

External webhook execution is disabled. Existing webhook-bearing bot configurations fail closed until reviewed and resaved.

Lead capture remains subject to KV consistency limitations and is not a transactional CRM.

## Destructive administration

Bot deletion requires:

```json
{ "botId": "...", "confirm": "DELETE_BOT" }
```

Global bot deletion requires:

```json
{ "confirm": "DELETE_ALL_BOTS" }
```

The static admin console does not expose global deletion controls.

## Counter and consistency limitations

Workers KV is eventually consistent. The historical implementation uses non-atomic read-modify-write operations for rate counters, daily budgets and some indexes.

Consequences:

- concurrent requests may temporarily exceed configured limits;
- concurrent index writes may overwrite one another;
- cross-region reads may observe prior values briefly.

These controls reduce abuse and cost but are not strict quotas. Durable Objects or another transactional coordinator are required for high-assurance enforcement.

## Source-control boundary

This is a public repository. The source gate scans tracked files and rejects:

- real environment and Wrangler variable files;
- private key material;
- common live provider tokens;
- credential-bearing URLs;
- non-placeholder sensitive assignments;
- npm authentication tokens.

The gate reports rule names and file paths only. It does not print matched values.

## Required gates

The authoritative Worker validation command is:

```powershell
npm run check
```

Order is mandatory:

1. tracked-source secret safety;
2. deterministic security architecture contract;
3. TypeScript validation.

The npm `predeploy` hook runs this chain before Wrangler deployment. The read-only GitHub Actions workflow runs the same checks without requesting Worker secrets and without deploying.
