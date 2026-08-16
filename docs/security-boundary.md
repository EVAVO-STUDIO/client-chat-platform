# Client Chat Platform security boundary

## Purpose

This document describes the active trust boundary for `EVAVO-STUDIO/client-chat-platform`.

Wrangler deploys:

```text
worker/src/runtime.ts
```

The active runtime contract is `client_chat_active_runtime_v2`. The entrypoint removes retired request aliases, constrains model execution, blocks implicit model-driven lead storage and exposes the separate explicit-consent lead route. It delegates ordinary requests to `worker/src/hardened.ts`, which wraps selected historical compatibility behaviour in `worker/src/index.ts`. Neither compatibility module may be the Wrangler entrypoint.

## Trust zones

### Public browser

The browser widget is untrusted. It may provide only:

- a valid bot identifier;
- a bounded sequence of visitor and assistant messages;
- normal browser CORS headers;
- an explicit follow-up request containing exact boolean consent, bounded visitor-message evidence and bounded contact fields.

The browser cannot provide:

- an administrator credential;
- a system message;
- raw provider options or debug output;
- a workspace, tenant, role or entitlement;
- a bot key in JSON;
- a knowledge URL or webhook destination;
- destructive-administration confirmation.

### Non-browser chat client

A non-browser caller generally has no `Origin` header. It must provide the configured bot key in `x-bot-key` when calling `/api/chat`.

The bot key is not an administrator credential. It cannot modify configuration, refresh knowledge, read leads or use `/api/leads`. Explicit lead capture requires a browser `Origin` that exactly matches stored bot configuration.

### Administrator

Every `/admin/*` request must:

- use `POST`;
- use exact Bearer authentication;
- carry a 32–256 byte configured `ADMIN_TOKEN`;
- originate from an allowed hosted admin origin, or localhost during development when a browser sends `Origin`;
- use a bounded JSON object when the route accepts a body.

`x-admin-token` is retired. `worker/src/runtime.ts` removes it before any router or compatibility adapter sees the request.

### Cloudflare bindings

The Worker uses:

- Workers AI for model inference;
- `BOT_CONFIG` KV for reviewed bot configuration and explicit visitor-approved lead records;
- `KB_CACHE` KV for verified knowledge-cache records and best-effort counters.

KV namespace IDs in Wrangler are binding identifiers, not bearer credentials. Real secrets belong in Cloudflare secret storage or ignored local `.dev.vars` files.

## Final runtime boundary

`worker/src/runtime.ts`:

- removes the retired administrator header globally;
- validates the actual model identifier immediately before Workers AI receives it;
- replaces a missing, malformed or known-retired model with `@cf/meta/llama-3.2-3b-instruct`;
- bounds Workers AI completion with a 20-second timeout;
- wraps `BOT_CONFIG` during `/api/chat` so historical `lead:*` reads, writes and deletes cannot occur;
- routes `/api/leads` to the explicit-consent service with the real bindings;
- stamps every response with `X-EVAVO-Chat-Runtime: client_chat_active_runtime_v2`.

The model fallback does not rewrite KV or disclose substitution in response data. Operators should still resave old records so stored configuration truthfully describes runtime behaviour.

## Request boundary

`worker/src/security.ts` enforces:

- JSON media types only;
- declared and observed byte limits;
- strict UTF-8 decoding;
- object-root JSON;
- maximum depth, node count, array length, key length and string length;
- rejection of `__proto__`, `prototype` and `constructor` keys.

Current server limits include:

```text
admin JSON: 64 KiB
chat JSON: 128 KiB
explicit lead JSON: 32 KiB
chat messages: 30
single chat message: 8,000 characters
combined chat message content: 75,000 characters
visitor-evidence messages: 20
visitor-evidence total: 20,000 characters
```

The widget applies tighter visitor-input limits. Server checks remain authoritative.

## Administrator authentication

The Worker accepts only:

```http
Authorization: Bearer <ADMIN_TOKEN>
```

Both supplied and configured values must satisfy the bounded credential shape. Their SHA-256 digests are compared with a fixed-length comparison. Public health output does not reveal whether the token is configured.

## Browser-origin policy

Every bot configuration requires at least one exact origin. Wildcards are rejected.

Allowed production form:

```text
https://example.com
```

Allowed local-development forms:

```text
http://localhost:3000
http://127.0.0.1:3000
```

Origins cannot contain credentials, paths, query strings or fragments. CORS preflight is not authorization; the actual chat and lead requests resolve bot configuration and recheck the exact origin.

## Bot-key policy

A configured bot key must be 16–256 characters with no whitespace or control characters.

A valid exact browser origin does not need a bot key for `/api/chat`. A request without `Origin` must present:

```http
x-bot-key: <BOT_KEY>
```

The hardened router consumes the key before compatibility code runs and removes it from model-facing configuration. `/api/leads` never accepts a bot key or non-browser request.

## Configuration boundary

`worker/src/configBoundary.ts` constructs a reviewed allowlist. Unknown fields are not forwarded as authoritative configuration.

It:

- requires exact origins;
- accepts only safe contact URLs and public HTTPS knowledge URLs;
- bounds text, numeric and array fields;
- normalises lead mode to `soft`, `balanced` or `direct`;
- forces simple cached retrieval;
- rejects webhook URL, authentication and secret fields;
- permits only `open_contact`, `create_lead` and `none` model actions;
- clears omitted unsafe legacy action and URL state rather than preserving it.

`create_lead` means “offer the visitor an explicit follow-up choice.” It is not storage authority.

## Knowledge retrieval boundary

Public chat performs no external network fetch.

Only authenticated:

```text
POST /admin/kb/refresh
```

may fetch configured knowledge URLs.

Each source must be public HTTPS. The fetch boundary:

- rejects URL credentials and sensitive query-key names;
- rejects private, loopback, link-local, reserved, documentation and internal hosts;
- rejects non-standard ports;
- follows redirects manually only after validating the next target;
- keeps one deadline active through request, redirects, headers and streamed body reading;
- limits decoded bytes and rejects binary-looking bodies;
- accepts text, HTML and XHTML media types only.

Wrangler also enables:

```text
global_fetch_strictly_public
```

This is a runtime SSRF boundary in addition to source-level URL validation.

## Knowledge-cache contract

A source URL is never used directly as a KV key. The key is:

```text
kb:v2:<64-character SHA-256 hex digest>
```

The resulting key is 70 bytes.

Each exact-shape cache record contains:

- cache contract version;
- requested and final URLs;
- fetch timestamp and source byte count;
- SHA-256 digest of stored text;
- bounded stripped text.

Before model use, the Worker verifies record shape, URL policy and text digest. Legacy plain-string cache values are not authoritative. Fetched excerpts are labelled as untrusted factual reference, and the model is told not to follow instructions found inside them.

## Model and response boundary

Before compatibility code invokes the model, the hardened router has:

- authorised the exact origin or bot key;
- validated message shape;
- loaded safe configuration;
- replaced live retrieval with verified cached excerpts;
- removed bot-key enforcement from delegated configuration;
- removed unsafe external actions.

The final runtime validates the actual model argument and enforces the timeout. The returned response is re-read through a bounded stream.

Public responses:

- must be JSON;
- cannot contain `raw`, `stack` or `cause` fields;
- cannot expose detailed provider errors on failure;
- receive no-store and defensive headers.

The widget renders model text with `textContent`, never HTML.

## Explicit visitor-consent lead boundary

A model action cannot store a lead during `/api/chat`. The runtime replaces the chat request’s `BOT_CONFIG` binding with a wrapper that returns no lead records or indexes and ignores every `lead:*` write and delete.

The widget treats `create_lead` as a proposal. It derives the email, message and optional name, company or phone only from visitor-authored messages. It then displays:

- the exact email;
- a bounded message excerpt;
- the statement that nothing is saved until **Share for follow-up** is selected;
- the 90-day retention window.

Only a separate:

```text
POST /api/leads
```

may store a record. `worker/src/leadCapture.ts` requires:

- exact browser-origin approval;
- exact boolean `consent: true`;
- a valid, safe bot configuration;
- bounded visitor-authored evidence;
- a required email and message;
- every stored contact field to appear in the visitor evidence;
- a privacy-preserving best-effort rate bucket.

Evidence is used only for verification and is not stored with the lead. Raw IP addresses and user-agent strings are not stored. The response contains an ID, timestamps, consent version and retention period but echoes no contact fields.

Explicit lead records and their index receive a 90-day KV expiration. Existing index entries older than the retention window are pruned when a new explicit lead is stored.

Storage and index updates are separate KV writes. The service attempts compensating deletion if the index write fails, but it cannot provide an atomic transaction.

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

## KV consistency limitations

Workers KV is eventually consistent. Historical rate counters, daily budgets, lead rate buckets and indexes use non-atomic read-modify-write operations.

Consequences include:

- concurrent requests temporarily exceeding a configured limit;
- concurrent index writes overwriting one another;
- cross-region reads observing prior values briefly.

These controls reduce abuse, cost and data lifetime but are not strict quotas or transactions. Durable Objects or another transactional coordinator are required for high-assurance enforcement.

## Source-control boundary

This is a public repository. The tracked-source gate rejects:

- real environment and Wrangler variable files;
- private key material;
- common live provider tokens;
- credential-bearing URLs;
- non-placeholder sensitive assignments;
- npm authentication tokens.

The gate reports rule names and file paths only. It never prints matched values.

## Required gates

The authoritative validation command is:

```powershell
npm run check
```

Order is mandatory:

1. tracked-source secret safety;
2. administrator configuration and runtime-storage behavior safety through the security prehook;
3. deterministic security architecture contract;
4. Super EVA widget, bounded-streaming and presentation-contract validation;
5. TypeScript validation;
6. Wrangler no-deploy dry-run bundle.

`npm run check:bundle` writes only to the ignored `.wrangler/dry-run` directory. The npm `predeploy` hook runs the complete chain before deployment. The read-only GitHub Actions workflow runs the same checks without requesting Worker secrets and without publishing the Worker.
