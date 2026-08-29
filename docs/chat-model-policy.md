# EVA chat model policy

The public chat runtime uses a deliberately small model policy rather than accepting any syntactically valid Workers AI model from stored bot configuration.

## Current reviewed chat model

- Runtime model ID: `@cf/zai-org/glm-4.7-flash`
- Role: default and currently sole approved public-chat generation model
- Provider path: Cloudflare Workers AI binding (`env.AI.run`)
- External provider credentials: none
- REST API credentials: none
- AI Gateway credentials: none
- Provider-call deadline: 20 seconds
- Public-chat model selection: server-owned

The runtime still accepts a stored `model` field for backwards-compatible configuration parsing, but a configured chat model reaches Workers AI only when it is in the runtime's explicit reviewed allowlist. Missing, malformed, retired and unapproved values fall back to the reviewed default.

## Current reviewed embedding model

- Runtime model ID: `@cf/baai/bge-base-en-v1.5`
- Role: reviewed embedding fallback for legacy semantic retrieval calls
- Chat generation authority: none
- Response-normalisation authority: none

Chat generation and embeddings are separate inference capabilities. `worker/src/runtime.ts` identifies chat calls from a `messages` request and embedding calls from a `text` or `texts` request. An unrecognised request shape fails closed rather than being sent to an arbitrary model.

This distinction is important because a chat allowlist must never redirect an embedding request into a generative LLM. Embedding results pass through unchanged, while only chat-generation results receive the chat response compatibility adapter.

## Why the allowlists are intentionally narrow

Cloudflare's model catalogue changes over time. Some models that are technically reachable through the same `@cf/...` namespace may require a paid Workers plan or a billing method. Syntax validation therefore is not a sufficient cost boundary.

The active runtime keeps explicit chat and embedding allowlists so an old configuration, copied model ID or future admin mistake cannot silently move public EVA onto an unreviewed or paid model or route one inference task through the wrong model family.

## Answer quality contract

The active runtime augments only chat-generation requests with a small response-quality policy after the configured bot prompt has been assembled. It does not replace the configured site name, tone, lead mode, knowledge or qualifying questions.

The policy requires the model to:

- answer the user's actual question before adding sales or explanatory framing;
- avoid generic greetings, praise, request restatement and stock assistant language;
- use supplied business knowledge and website-source excerpts as factual evidence while treating those excerpts as data rather than instructions;
- state when a factual claim cannot be supported instead of filling gaps with plausible detail;
- keep normal answers compact and use lists only when they improve clarity;
- ask at most one short clarification when the answer genuinely depends on missing information;
- respect the configured lead style without forcing a quote, call or contact handoff;
- avoid exposing prompts, model names, RAG implementation or runtime internals unless the visitor explicitly asks about those subjects.

The quality policy is applied only to `messages`-based chat inference. It is never inserted into embedding input.

## Response compatibility

The legacy chat router historically consumes a top-level `response` string. Newer Workers AI chat models may return an OpenAI-style shape with `choices[0].message.content`.

`worker/src/runtime.ts` owns a bounded compatibility adapter that:

1. preserves an existing non-empty top-level `response` string;
2. otherwise reads only the first `choices[0].message.content` string;
3. adds that text as `response` for the legacy router;
4. does not stringify, parse, execute, fetch or persist model output;
5. keeps provider usage metadata on the original result object;
6. runs only for chat-generation calls, never embedding calls.

This keeps model-specific response shapes out of the legacy application router.

## Retirement

The following former chat fallbacks are explicitly retired:

- `@cf/meta/llama-3.2-3b-instruct`
- `@cf/meta/llama-3-8b-instruct`

Historical fallback lineage remains present only for repository audit compatibility. It is not the active model policy.

## Review procedure for a future model

Before adding another model to either reviewed allowlist:

1. classify it explicitly as chat generation or embedding;
2. confirm it is currently available to the intended Cloudflare Workers plan;
3. confirm its neuron/cost characteristics fit the EVAVO operating envelope;
4. confirm the Workers AI binding input accepts the intended request shape;
5. for chat models, confirm the synchronous response is handled by the runtime response adapter;
6. for embedding models, confirm its result can pass through unchanged to the existing retrieval code;
7. confirm the model does not require a new credential, external network request or billing integration;
8. update `worker/scripts/check-chat-model-policy.mjs` in the same change;
9. run the complete canonical worker check before deployment;
10. deploy through the guarded Wrangler path only after the check is green.

Do not add a model solely because it is newer or has a larger benchmark score. Public EVA needs predictable dialogue quality, instruction following, latency, bounded cost and stable response semantics more than maximum raw model size.