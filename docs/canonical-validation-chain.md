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
4. read-only administrator reviewed-model UI truth.

The administrator model UI migration is complete: the console displays the reviewed GLM-4.7-Flash model as server-owned, read-only state and cannot submit arbitrary operator-entered model identifiers.

The nested arrangement is intentional. Do not add those focused checks as new top-level `npm run check` stages merely for visibility: the exact top-level chain is part of the security contract and should change only through a deliberate audited release.

`check:bundle` is a Wrangler no-deploy dry run. The canonical check must not publish the Worker, read provider credentials from source, or substitute a deployment for validation.

Normal production deployment remains the guarded root lifecycle command:

```powershell
cd C:\GitRepos\client-chat-platform
cmd /c "npm run deploy"
```

The root `predeploy` lifecycle reruns the canonical Worker validation before Wrangler uploads the active `worker/src/runtime.ts` entrypoint.
