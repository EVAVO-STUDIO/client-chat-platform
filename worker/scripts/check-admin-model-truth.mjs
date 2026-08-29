#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(workerRoot, "..");
const adminPath = path.join(repositoryRoot, "admin", "index.html");
const storagePath = path.join(workerRoot, "src", "runtimeStorageBoundary.ts");
const policyPath = path.join(repositoryRoot, "docs", "chat-model-policy.md");
const migrationPath = path.join(repositoryRoot, "docs", "admin-model-ui-migration.md");

const admin = fs.readFileSync(adminPath, "utf8");
const storage = fs.readFileSync(storagePath, "utf8");
const policy = fs.readFileSync(policyPath, "utf8");
const migration = fs.readFileSync(migrationPath, "utf8");
const REVIEWED_MODEL = "@cf/zai-org/glm-4.7-flash";
const RETIRED_MODEL = "@cf/meta/llama-3.2-3b-instruct";

for (const [label, source] of [
  ["admin", admin],
  ["storage", storage],
  ["policy", policy],
  ["migration", migration],
]) {
  assert.ok(
    source.length > 0 && !source.includes("\r"),
    `${label} model-truth source must be non-empty LF text`,
  );
}

for (const required of [
  `const REVIEWED_CHAT_MODEL = "${REVIEWED_MODEL}";`,
  "function scrubRetiredConfigSecrets(config: JsonObject)",
  "next.model = REVIEWED_CHAT_MODEL;",
  "const scrubbed = scrubRetiredConfigSecrets(next);",
  "const projected = scrubRetiredConfigSecrets(source);",
  "reviewedChatModelCanonicalizedOnConfigWrite: true",
  "reviewedChatModelCanonicalizedInAdminProjection: true",
  "reviewedChatModel: REVIEWED_CHAT_MODEL",
]) {
  assert.ok(
    storage.includes(required),
    `storage model-truth boundary missing: ${required}`,
  );
}

const scrubStart = storage.indexOf("function scrubRetiredConfigSecrets(config: JsonObject)");
const scrubEnd = storage.indexOf("async function protectedConfigValue", scrubStart);
assert.ok(scrubStart >= 0 && scrubEnd > scrubStart, "shared config scrubber is missing");
const scrub = storage.slice(scrubStart, scrubEnd);
assert.ok(
  scrub.includes("next.model = REVIEWED_CHAT_MODEL;"),
  "shared config scrubber must canonicalize the reviewed chat model",
);
assert.ok(
  storage.indexOf("const scrubbed = scrubRetiredConfigSecrets(next);") > scrubEnd,
  "protected writes must use the shared config scrubber",
);
assert.ok(
  storage.indexOf("const projected = scrubRetiredConfigSecrets(source);") > scrubEnd,
  "administrator projections must use the shared config scrubber",
);

for (const required of [
  "protected configuration boundary also converges stored/admin truth onto the reviewed model",
  "`/admin/get` projects the reviewed GLM model",
  "next protected configuration save persists that same model",
  REVIEWED_MODEL,
]) {
  assert.ok(
    policy.toLowerCase().includes(required.toLowerCase()),
    `model policy missing stored-model truth rule: ${required}`,
  );
}

for (const required of [
  "# Administrator model UI contract",
  "historical editable Llama model field has been retired",
  "Reviewed chat model",
  REVIEWED_MODEL,
  "keep the control read-only or render it as non-editable status text",
  "never expose provider credentials, billing controls or arbitrary model discovery",
  "must never send visitor/operator-entered arbitrary model identifiers",
  "`credentials: \"omit\"` and `referrerPolicy: \"no-referrer\"` remain intact",
  "exact Bearer authorization remains intact",
  "the retired Llama placeholder stays absent",
  "editable model authority stays absent",
  "server model allowlist remains the execution authority",
]) {
  assert.ok(
    migration.includes(required),
    `admin model UI contract missing: ${required}`,
  );
}

for (const forbidden of [
  "migration debt, not supported model-selection authority",
  "When `admin/index.html` is edited through a patch-safe local workflow",
]) {
  assert.ok(
    !migration.includes(forbidden),
    `completed admin model contract still describes pending debt: ${forbidden}`,
  );
}

for (const required of [
  "Reviewed chat model",
  `value="${REVIEWED_MODEL}"`,
  'readonly aria-readonly="true"',
  "Server-owned reviewed policy.",
  `const REVIEWED_CHAT_MODEL = "${REVIEWED_MODEL}";`,
  "model: REVIEWED_CHAT_MODEL,",
  'setText("model", REVIEWED_CHAT_MODEL);',
  'credentials: "omit"',
  'referrerPolicy: "no-referrer"',
  "Authorization: `Bearer ${token}`",
]) {
  assert.ok(admin.includes(required), `admin reviewed-model UI missing: ${required}`);
}

for (const forbidden of [
  RETIRED_MODEL,
  'model: text("model") || undefined',
  'setText("model", config.model)',
  'placeholder="@cf/',
]) {
  assert.ok(
    !admin.includes(forbidden),
    `admin still exposes arbitrary or retired model authority: ${forbidden}`,
  );
}

const modelInput = admin.match(/<input id="model"[^>]*>/u)?.[0] ?? "";
assert.ok(modelInput, "reviewed model input is missing");
assert.ok(modelInput.includes("readonly"), "reviewed model input must stay read-only");
assert.ok(
  modelInput.includes(REVIEWED_MODEL),
  "reviewed model input must display the canonical GLM model",
);
assert.ok(
  !modelInput.includes("placeholder="),
  "reviewed model input must not imply a selectable model placeholder",
);

for (const forbidden of [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "AI_GATEWAY_TOKEN",
  "process.env",
  "fetch(",
]) {
  assert.ok(
    !storage.includes(forbidden),
    `storage model-truth boundary gained provider authority: ${forbidden}`,
  );
}

console.log("EVAVO admin model truth contract passed.");
console.log(`- one shared storage scrubber canonicalizes protected writes and admin projections to ${REVIEWED_MODEL}`);
console.log("- the model field is read-only and cannot grant arbitrary operator model-selection authority");
console.log("- save and load paths preserve the reviewed model while Bearer auth, no-referrer and credentials-omit behavior remain intact");
console.log("- the retired Llama placeholder and arbitrary model payload path are absent");
console.log("- the admin model UI migration is complete and documented as a current invariant");
