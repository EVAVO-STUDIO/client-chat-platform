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
2. GLM/BGE chat-model policy;
3. stored/admin-projected model truth;
4. read-only administrator reviewed-model UI truth;
5. hardened Worker quickstart contract;
6. reviewed EVAVO recovery seed.

The administrator model UI migration is complete: the console displays the reviewed GLM-4.7-Flash model as server-owned, read-only state and cannot submit arbitrary operator-entered model identifiers.

The hardened Worker quickstart is also part of the executable policy surface. It must continue to use the current configuration schema, exact Bearer administration, bounded `messages` chat input, cached-only public knowledge flow, reviewed GLM/BGE ownership, and explicit visitor-approved lead capture. Retired single-message chat examples, direct model-driven lead storage and unguarded deployment commands are forbidden.

The reviewed EVAVO recovery seed is likewise executable policy. `worker/upsert-evavo.json` must stay on GLM-4.7-Flash, current bounded request/token settings, current public EVAVO knowledge URLs, and consent-gated `open_contact` / `create_lead` actions. It must not reintroduce retired Llama IDs, the removed `/pricing` source, webhook fields, unlimited token budgets or legacy prompt fields.

The nested arrangement is intentional. Do not add those focused checks as new top-level `npm run check` stages merely for visibility: the exact top-level chain is part of the security contract and should change only through a deliberate audited release.

`check:bundle` is a Wrangler no-deploy dry run. The canonical check must not publish the Worker, read provider credentials from source, or substitute a deployment for validation.

Normal production deployment remains the guarded root command:

```powershell
cd C:\GitRepos\client-chat-platform
cmd /c "npm run deploy"
```

The root `deploy` script delegates to `npm --prefix worker run deploy`. npm then executes the worker package's `predeploy` lifecycle automatically; worker `predeploy` is exactly `npm run check`. Only after that complete validation chain succeeds does the worker `deploy` script run `wrangler deploy -c wrangler.jsonc` against the active `worker/src/runtime.ts` entrypoint.

The security contract pins all three links in that lifecycle: root delegation, worker `predeploy`, and the final Wrangler deploy command. Do not replace the root deploy script with a direct Wrangler invocation.
