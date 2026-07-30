# Client Chat Security and Origin Contract

The client widget and Cloudflare Worker must fail closed at every browser and provider boundary.

## Exact origin allowlist

Every client installation has an explicit allowlist of HTTPS origins. Origin matching is exact after canonical URL parsing. Substring, suffix and regular-expression shortcuts are prohibited unless a reviewed client contract explicitly defines a bounded wildcard rule.

A wildcard origin is prohibited for credentialed or tenant-bound requests. `Access-Control-Allow-Origin: *` must not be combined with credentials or authorization.

The Worker must reject missing, opaque, malformed, non-HTTPS and unapproved origins before reading a message body or invoking an upstream model or service.

## CORS and preflight

An OPTIONS request is a preflight, not an authenticated chat request. Preflight responses must:

- validate the requested origin;
- allow only the required methods;
- allow only the required request headers;
- set bounded cache lifetime;
- avoid exposing secrets or tenant configuration;
- include `Vary: Origin` where origin-specific responses are cached.

The actual request repeats the exact origin check. Passing preflight never grants continuing authorization.

## Credentials and authorization

Provider credentials remain in the Worker secret boundary and are never returned to the widget, browser logs or client configuration. User or tenant authorization is separate from origin approval. An allowed origin without valid authorization receives no protected chat history or tenant data.

Authentication failures must not disclose whether another tenant, conversation or user exists.

## Request bounds

Every request has explicit content type, body size, message count, per-message size, attachment count and execution timeout bounds. Decompression bombs, recursive content, oversized metadata and unbounded streaming are rejected.

Rate limits apply by a privacy-preserving combination of tenant, authenticated subject and coarse network abuse signals. Rate-limit responses disclose no secret counters or other-tenant state.

## Browser security

The embeddable widget requires a documented content security policy (CSP) integration. The host page should restrict script, connection, frame and style sources to the minimum required set. The widget must not inject unsanitised HTML, execute returned code or trust model-generated URLs.

PostMessage communication, when used, requires exact target and sender origins plus a typed message envelope. `*` is not an acceptable target origin for protected messages.

## Logs and evidence

Logs contain request IDs, bounded error classes, timing and provider outcome, not raw credentials or unrestricted message content. Synthetic fixtures are used for source and browser validation.

Production worker smoke evidence is separate from Wrangler dry-run evidence and is published only against the exact source SHA through `evavo/evidence/production-worker-smoke`.
