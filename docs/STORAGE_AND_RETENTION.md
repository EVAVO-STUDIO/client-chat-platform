# Client Chat Storage and Retention Contract

Client Chat data is separated by client tenant, authenticated subject and conversation. Storage design must preserve those boundaries in keys, queries, caches, exports, logs and deletion paths.

## Tenant boundary

Every stored object carries or derives an immutable tenant identifier. The tenant comes from trusted authorization state, never a browser-provided display name or unverified request field. A query that omits the tenant boundary is invalid for protected data.

Client configuration, prompts, conversation state, attachments, usage records and provider mappings cannot be shared across tenants unless an explicit non-customer global record is defined and reviewed.

## Content minimisation

Store the minimum content required for the declared client feature. Do not retain complete prompts, model responses, attachments or personal identifiers merely for analytics. Operational metrics use bounded categories and counts rather than unrestricted message content.

Sensitive content is excluded from normal application logs. Debug logging that can contain chat content is disabled in production and requires a separately authorised, time-bounded support process.

## Encryption and secrets

Data is encrypted in transit. Provider keys, webhook secrets, signing keys and administrative credentials remain in provider secret storage and are not persisted in tenant records, widget bundles or logs.

At-rest protections follow the selected Cloudflare storage product and client contract. Application-level encryption, when used, must include versioned key identity and a rotation plan without embedding keys in source.

## Retention and expiry

Every persistent record class has a documented retention period or explicit non-expiring justification. Temporary request data and failed upload fragments expire quickly. Conversation retention is controlled by the client contract and exposed accurately to the user where applicable.

Retention jobs are idempotent, tenant-bound and observable without logging deleted content. A missed expiry run must be detectable and safely repeatable.

## Deletion

Deletion removes application-managed primary records, indexes, caches and derived records for the requested tenant and conversation scope. The operation is authorised independently of origin approval and is safe to retry.

Deletion evidence identifies record classes and counts, not deleted content. Backups and provider-retained logs outside application control are documented with their own expiry and recovery policy.

## Backup and recovery

Backups preserve tenant boundaries and are access-controlled. Recovery is tested into an isolated environment before any production restore. A restore must not resurrect records whose deletion tombstone or retention expiry is newer than the backup snapshot.

Rollback evidence covers Worker version, binding/schema compatibility, storage migration state and client widget compatibility. Source success alone is not rollback proof.

## Observability

Logs and traces contain request IDs, tenant-safe pseudonymous identifiers, duration, bounded status and provider error class. They do not contain credentials, unrestricted chat content or other-tenant identifiers.

Exact-SHA evidence for this contract is published through:

```text
evavo/evidence/storage-and-retention-contract
evavo/evidence/rollback-proof
```
