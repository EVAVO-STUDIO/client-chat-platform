# Administrator model UI migration

The Worker runtime and protected configuration boundary already own the public-chat model policy. The reviewed chat model is:

```text
@cf/zai-org/glm-4.7-flash
```

The administrator console still contains a historical editable model field whose placeholder references the retired Llama fallback. That field is migration debt, not supported model-selection authority.

## Target operator experience

The administrator console should present the model as server-owned configuration:

- label it `Reviewed chat model`;
- show `@cf/zai-org/glm-4.7-flash`;
- make the control read-only or render it as non-editable status text;
- explain briefly that model changes require a reviewed runtime-policy update;
- never expose provider credentials, billing controls or arbitrary model discovery;
- never imply that typing another `@cf/...` identifier changes the executing model.

The existing bot-key field and explicit clear control are unrelated and must keep their current semantics.

## Payload rule

A safe admin UI may either:

1. send the exact reviewed model value `@cf/zai-org/glm-4.7-flash`; or
2. omit the model field and let the server-owned boundary supply the reviewed model.

It must not send visitor/operator-entered arbitrary model identifiers.

The protected storage boundary remains authoritative even after this UI patch. It must continue to canonicalize stored configuration and sanitized `/admin/get` and `/admin/upsert` projections to the reviewed model.

## Patch constraints

When `admin/index.html` is edited through a patch-safe local workflow:

1. replace the retired Llama placeholder;
2. remove editable model authority;
3. preserve the admin token as a non-persistent password field;
4. preserve `credentials: "omit"` and `referrerPolicy: "no-referrer"`;
5. preserve exact Bearer authorization;
6. preserve bot-key configured/not-configured/unknown status behavior;
7. preserve explicit bot-key clear confirmation;
8. keep webhook/auth-secret fields absent;
9. update `worker/scripts/check-admin-model-truth.mjs` in the same commit;
10. run the canonical Worker check before deployment.

Do not weaken the server model allowlist merely to make the historical form field appear functional.
