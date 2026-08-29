# Administrator model UI contract

The Worker runtime and protected configuration boundary own the public-chat model policy. The reviewed chat model is:

```text
@cf/zai-org/glm-4.7-flash
```

The administrator console now reflects that authority directly. The historical editable Llama model field has been retired and is no longer an operator model-selection surface.

## Current operator experience

The administrator console must present the model as server-owned configuration:

- label it `Reviewed chat model`;
- show `@cf/zai-org/glm-4.7-flash`;
- keep the control read-only or render it as non-editable status text;
- explain briefly that model changes require a reviewed runtime-policy update;
- never expose provider credentials, billing controls or arbitrary model discovery;
- never imply that typing another `@cf/...` identifier changes the executing model.

The existing bot-key field and explicit clear control are unrelated and keep their current semantics.

## Payload rule

The current admin UI sends the exact reviewed model value `@cf/zai-org/glm-4.7-flash`. A future UI may instead omit the model field and let the server-owned boundary supply the reviewed model, but it must never send visitor/operator-entered arbitrary model identifiers.

The protected storage boundary remains authoritative. It continues to canonicalize stored configuration and sanitized `/admin/get` and `/admin/upsert` projections to the reviewed model.

## Invariants

Any future `admin/index.html` edit must preserve all of the following:

1. the retired Llama placeholder stays absent;
2. editable model authority stays absent;
3. the admin token remains a non-persistent password field;
4. `credentials: "omit"` and `referrerPolicy: "no-referrer"` remain intact;
5. exact Bearer authorization remains intact;
6. bot-key configured/not-configured/unknown status behavior remains intact;
7. explicit bot-key clear behavior remains intact;
8. webhook/auth-secret fields remain absent;
9. `worker/scripts/check-admin-model-truth.mjs` stays in the canonical Worker validation chain;
10. the server model allowlist remains the execution authority.

Do not weaken the server model allowlist or reintroduce arbitrary model selection merely to expose more configuration in the operator UI.
