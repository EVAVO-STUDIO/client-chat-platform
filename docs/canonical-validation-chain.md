# Canonical Worker validation chain

`client-chat-platform` keeps one audited Worker validation command:

```powershell
cd C:\GitRepos\client-chat-platform\worker
cmd /c "npm run check"
```

The top-level Worker `check` script remains:

1. `npm run check:source-secrets`
2. `npm run check:security`
3. `npm run check:super-eva`
4. `npm run typecheck`
5. `npm run check:bundle`

`npm run check:config-secrets` is invoked automatically by the `precheck:security` npm lifecycle hook before `check:security`.

`check:super-eva` is an umbrella compatibility gate. It runs these focused checks before its own SUPER EVA assertions:

1. portable Shadow DOM widget contract;
2. GLM/BGE chat-model policy v2;
3. model inference boundary behavior;
4. bounded GLM completion-field compatibility policy;
5. stored/admin-projected model truth;
6. read-only administrator reviewed-model UI truth;
7. hardened Worker quickstart contract;
8. reviewed EVAVO recovery seed;
9. reviewed EVAVO seed apply helper;
10. read-only EVAVO activation verifier.

The active model-policy authority is `worker/scripts/check-chat-model-policy-v2.mjs`. It validates independent runtime, inference-boundary, documentation and deployment capabilities instead of pinning one exact prose sentence. The older `check-chat-model-policy.mjs` remains historical audit evidence and is not invoked by the canonical `check:super-eva` gate.

The model inference boundary behavior check transpiles and executes the real authority-free `src/modelInferenceBoundary.ts` module. It verifies non-empty chat input, bounded scalar/batch embedding input, malformed and oversized rejection, and fail-closed chat/embedding plus `text`/`texts` ambiguity. The classifier has no provider, network or storage authority and `runtime.ts` must not retain a second independent classifier.

The bounded completion-field policy preserves the legacy router's established 1,024-token hard maximum while translating its internal `max_tokens` value to Cloudflare's current `max_completion_tokens` field at the active model boundary. A missing internal limit gets an explicit 512-token fallback, conflicting or oversized completion limits fail closed, and embeddings do not pass through this chat-only adapter.

The administrator model UI migration is complete: the console displays the reviewed GLM-4.7-Flash model as server-owned, read-only state and cannot submit arbitrary operator-entered model identifiers.

The hardened Worker quickstart is also part of the executable policy surface. It must continue to use the current configuration schema, exact Bearer administration, bounded `messages` chat input, cached-only public knowledge flow, reviewed GLM/BGE ownership, and explicit visitor-approved lead capture. Retired single-message chat examples, direct model-driven lead storage and unguarded deployment commands are forbidden.

The reviewed EVAVO recovery seed is likewise executable policy. `worker/upsert-evavo.json` must stay on GLM-4.7-Flash, current bounded request/token settings, current public EVAVO knowledge URLs, evidence-bound response wording and consent-gated `open_contact` / `create_lead` actions. It must not reintroduce retired Llama IDs, the removed `/pricing` source, webhook fields, unlimited token budgets or legacy prompt fields.

The reviewed EVAVO seed apply helper is checked as code but is **not executed** by the validation chain. Its guard requires an explicit target Worker URL, Bearer administrator token and confirmation value; verifies the hardened runtime before mutation; uses only `/admin/upsert`, `/admin/get` and `/admin/kb/refresh`; and fails closed on a partial knowledge refresh. The helper contains no Wrangler deployment or direct KV authority.

The read-only EVAVO activation verifier is also checked as code but is **not executed** by the validation chain because it needs the deployed Worker URL. It requires no administrator token and has no deployment, seed, KV or admin-route authority. After deployment and reviewed seed application it proves that `/health` exposes the exact hardened runtime contract, an approved `https://evavo.com.au` origin can chat without a bot key, a no-origin server request remains `bot_key_required`, the answer is bounded/non-empty, and model identifiers, raw provider output, bot keys, stacks and causes do not leak.

The nested arrangement is intentional. Do not add those focused checks as new top-level `npm run check` stages merely for visibility: the exact top-level chain is part of the security contract and should change only through a deliberate audited release.

`check:bundle` is a Wrangler no-deploy dry run. The canonical check must not publish the Worker, read provider credentials from source, apply the EVAVO seed, write production KV or substitute a deployment for validation.

Normal production deployment remains the guarded root command:

```powershell
cd C:\GitRepos\client-chat-platform
cmd /c "npm run deploy"
```

The root `deploy` script delegates to `npm --prefix worker run deploy`. npm then executes the worker package's `predeploy` lifecycle automatically; worker `predeploy` is exactly `npm run check`. Only after that complete validation chain succeeds does the worker `deploy` script run `wrangler deploy -c wrangler.jsonc` against the active `worker/src/runtime.ts` entrypoint.

The security contract pins all three links in that lifecycle: root delegation, worker `predeploy`, and the final Wrangler deploy command. Do not replace the root deploy script with a direct Wrangler invocation.

Applying the reviewed EVAVO bot configuration is a separate, explicit post-deploy operation:

```powershell
cd C:\GitRepos\client-chat-platform
$env:EVAVO_CHAT_WORKER_URL = "https://<reviewed-worker-host>"
$env:EVAVO_CHAT_ADMIN_TOKEN = "<current-admin-token>"
$env:EVAVO_CHAT_APPLY_SEED_CONFIRM = "APPLY_EVAVO_REVIEWED_SEED"
cmd /c "npm run apply:evavo-seed"
Remove-Item Env:EVAVO_CHAT_ADMIN_TOKEN
Remove-Item Env:EVAVO_CHAT_APPLY_SEED_CONFIRM
Remove-Item Env:EVAVO_CHAT_WORKER_URL
```

Do not merge this mutation into `npm run deploy`. A source release must never silently rewrite production bot configuration or knowledge-cache state.

After deployment and the reviewed seed/cache step, run the separate read-only activation verification:

```powershell
cd C:\GitRepos\client-chat-platform
$env:EVAVO_CHAT_WORKER_URL = "https://<reviewed-worker-host>"
cmd /c "npm run verify:evavo-activation"
Remove-Item Env:EVAVO_CHAT_WORKER_URL
```

This verification intentionally sends the approved EVAVO origin without `x-bot-key`. The first-party website path should succeed through its reviewed origin allowlist. A second request intentionally omits `Origin` and must fail with `bot_key_required`, preserving the direct server-to-server authentication boundary without requiring Vercel to hold a bot-key secret for the normal website proxy.
