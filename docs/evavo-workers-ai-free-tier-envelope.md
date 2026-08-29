# EVAVO Workers AI free-tier envelope

This document records the reviewed **bot-level** Workers AI envelope for the `evavo` recovery seed. It is not an account billing guarantee.

## Reviewed provider snapshot

Reviewed: **2026-08-29**

Cloudflare's Workers AI pricing documentation currently lists:

- Workers Free allocation: **10,000 Neurons per day**, reset at 00:00 UTC;
- `@cf/zai-org/glm-4.7-flash`: **5,500 neurons per million input tokens**;
- `@cf/zai-org/glm-4.7-flash`: **36,400 neurons per million output tokens**;
- `@cf/zai-org/glm-4.7-flash` remains available on Workers Free.

Cloudflare pricing and plan availability are external facts and can change. Re-review this document and `worker/scripts/check-evavo-seed-policy.mjs` before changing the reviewed model or budget.

## EVAVO seed limits

`worker/upsert-evavo.json` currently fixes:

- `maxTokens`: 320 per completion;
- `maxTurns`: 8;
- `maxCharsPerMessage`: 1,400;
- `maxRequestsPerDay`: 45;
- `maxTokensPerDay`: 45,000;
- `ragMode`: `simple`.

The legacy budget counter records total chat tokens from model usage when available, otherwise it estimates prompt plus completion tokens. The 45,000-token budget is therefore an internal chat-usage guard, not a direct copy of Cloudflare's Neuron unit.

## Conservative calculation

For a deliberately pessimistic upper-bound check, treat every one of the 45,000 budgeted chat tokens as if it were charged at GLM-4.7-Flash's more expensive output rate:

```text
45,000 / 1,000,000 × 36,400 = 1,638 neurons/day
```

The executable seed guard caps this reviewed pessimistic chat envelope at **2,000 neurons/day**. The real mixed input/output chat cost should be lower than that bound if provider pricing remains as reviewed.

`ragMode: simple` is deliberate for this calculation: the public EVAVO seed does not invoke embedding inference while answering normal chat requests, so embedding neurons are not silently omitted from this bot-level envelope.

## Important account-wide limitation

The Workers AI free allocation is account-wide. Other Workers, experiments, admin operations, model tests or repositories may consume Neurons from the same Cloudflare account. This repository therefore must **not** claim that its 2,000-neuron bot envelope guarantees the account will stay under 10,000 Neurons/day.

The purpose of the envelope is narrower: public EVAVO Chat remains intentionally conservative enough that its reviewed traffic/budget settings leave substantial room for other account activity.

If account-wide usage visibility becomes available through an authorised Cloudflare connection, actual Neuron usage should be checked there before raising any public-chat limits.
