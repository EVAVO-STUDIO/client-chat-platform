# EVA chat model policy

The public chat runtime uses a deliberately small model policy rather than accepting any syntactically valid Workers AI model from stored bot configuration.

## Current reviewed model

- Runtime model ID: `@cf/zai-org/glm-4.7-flash`
- Role: default and currently sole approved public-chat model
- Provider path: Cloudflare Workers AI binding (`env.AI.run`)
- External provider credentials: none
- REST API credentials: none
- AI Gateway credentials: none
- Provider-call deadline: 20 seconds
- Public-chat model selection: server-owned

The runtime still accepts a stored `model` field for backwards-compatible configuration parsing, but a configured model reaches Workers AI only when it is in the runtime's explicit reviewed allowlist. Missing, malformed, retired and unapproved values fall back to the reviewed default.

## Why the allowlist is intentionally narrow

Cloudflare's model catalogue changes over time. Some models that are technically reachable through the same `@cf/...` namespace may require a paid Workers plan or a billing method. Syntax validation therefore is not a sufficient cost boundary.

The active runtime keeps an explicit allowlist so an old configuration, copied model ID or future admin mistake cannot silently move public EVA onto an unreviewed or paid model.

## Response compatibility

The legacy chat router historically consumes a top-level `response` string. Newer Workers AI chat models may return an OpenAI-style shape with `choices[0].message.content`.

`worker/src/runtime.ts` owns a bounded compatibility adapter that:

1. preserves an existing non-empty top-level `response` string;
2. otherwise reads only the first `choices[0].message.content` string;
3. adds that text as `response` for the legacy router;
4. does not stringify, parse, execute, fetch or persist model output;
5. keeps provider usage metadata on the original result object.

This keeps model-specific response shapes out of the legacy application router.

## Retirement

The following former fallbacks are explicitly retired:

- `@cf/meta/llama-3.2-3b-instruct`
- `@cf/meta/llama-3-8b-instruct`

Historical fallback lineage remains present only for repository audit compatibility. It is not the active model policy.

## Review procedure for a future model

Before adding another model to `APPROVED_CHAT_MODELS`:

1. confirm it is currently available to the intended Cloudflare Workers plan;
2. confirm its neuron/cost characteristics fit the EVAVO operating envelope;
3. confirm the Workers AI binding input accepts the existing `messages` request;
4. confirm its synchronous response is handled by the runtime response adapter;
5. confirm the model does not require a new credential, external network request or billing integration;
6. update `worker/scripts/check-chat-model-policy.mjs` in the same change;
7. run the complete canonical worker check before deployment;
8. deploy through the guarded Wrangler path only after the check is green.

Do not add a model solely because it is newer or has a larger benchmark score. Public EVA needs predictable dialogue quality, instruction following, latency, bounded cost and stable response semantics more than maximum raw model size.
