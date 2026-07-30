# Client Chat Release Evidence

Client Chat release evidence is attached externally to the exact current `main` SHA. Source commits do not contain self-attesting evidence manifests.

Required contexts:

```text
evavo/evidence/source-validation
evavo/evidence/wrangler-dry-run
evavo/evidence/origin-and-cors-contract
evavo/evidence/storage-and-retention-contract
evavo/evidence/widget-browser-smoke
evavo/evidence/production-worker-smoke
evavo/evidence/rollback-proof
```

Each passing status points to a safe HTTPS reference containing the repository, exact source SHA, tool and version, runner identity, observation time, retained logs and SHA-256 artifact digests.

## Source validation

Requires the authoritative lockfile, exact package manager, lint, types, tests, Worker and widget builds, security contracts, storage contracts and complete release verification. Synthetic fixtures must be visibly synthetic and tenant isolated.

## Wrangler dry run

Must compile and bundle the exact Worker without provisioning or deployment. Evidence identifies Wrangler version, bindings expected by name and type, compatibility date, generated bundle digest and any size or module budget.

A dry run proves buildability, not live provider configuration or production behaviour.

## Origin and CORS contract

Must exercise allowed and rejected origins, malformed and opaque origins, OPTIONS preflight, credentials, authorization separation, request bounds, rate limiting and cache variation. Evidence contains no real provider key or customer chat content.

## Storage and retention contract

Must exercise tenant separation, record creation, expiry, deletion, cache/index cleanup and recovery using isolated synthetic tenants. It must prove that one tenant cannot enumerate, read, mutate or delete another tenant's records.

## Widget browser smoke

Must load the built widget in a real browser under at least one allowed and one rejected origin. It checks initialization, accessibility, network destinations, CSP integration, message flow, failure state, teardown and absence of credentials in the bundle or browser storage.

## Production worker smoke

Must target the exact deployed Worker version produced from the source SHA. It uses a dedicated synthetic tenant and bounded synthetic messages, verifies live origin enforcement and response handling, and retains provider deployment identity and request IDs.

A local Worker, preview route or Wrangler dry run does not satisfy this context.

## Rollback proof

Must demonstrate the governed rollback or safe recovery path for Worker code, bindings/schema and widget compatibility. Evidence identifies the pre-change and rollback deployment IDs, storage migration state and post-rollback smoke result. Destructive data rollback is not assumed.

## Status publication

Use Development Studio's governed status publisher:

```powershell
$env:EVAVO_EVIDENCE_AUTHORISATION_REFERENCE = `
  "evidence-authorisation:<evidence-id>:<transaction-id>"

pnpm release-evidence:publish -- `
  --dry-run `
  --repository EVAVO-STUDIO/client-chat-platform `
  --sha <exact-main-sha> `
  --evidence-id <approved-evidence-id> `
  --receipt <receipt.json>
```

Only the matching successful `--apply` operation may append the status after the dry run passes.
