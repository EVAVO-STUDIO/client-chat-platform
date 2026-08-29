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
  assert.ok(source.length > 0 && !source.includes("\r"), `${label} model-truth source must be non-empty LF text`);
}

for (const required of [
  `const REVIEWED_CHAT_MODEL = "${REVIEWED_MODEL}";`,
  "function canonicalChatModel()",
  "next.model = canonicalChatModel();",
  "projected.model = canonicalChatModel();",
  "storedModelCanonicalizedToReviewedChatModel: true",
  "adminModelProjectionCanonicalizedToReviewedChatModel: true",
]) {
  assert.ok(storage.includes(required), `storage model-truth boundary missing: ${required}`);
}

for (const required of [
  "Protected config writes now canonicalize the stored `model` field",
  "sanitized administrator projections also report that reviewed model",
  REVIEWED_MODEL,
]) {
  assert.ok(policy.includes(required), `model policy missing stored-model truth rule: ${required}`);
}

for (const required of [
  "# Administrator model UI migration",
  "migration debt, not supported model-selection authority",
  "Reviewed chat model",
  REVIEWED_MODEL,
  "make the control read-only or render it as non-editable status text",
  "never expose provider credentials, billing controls or arbitrary model discovery",
  "omit the model field and let the server-owned boundary supply the reviewed model",
  "must not send visitor/operator-entered arbitrary model identifiers",
  "preserve `credentials: \"omit\"`",
  "preserve exact Bearer authorization",
  "update `worker/scripts/check-admin-model-truth.mjs` in the same commit",
  "Do not weaken the server model allowlist",
]) {
  assert.ok(migration.includes(required), `admin model UI migration contract missing: ${required}`);
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
  assert.ok(!admin.includes(forbidden), `admin still exposes arbitrary or retired model authority: ${forbidden}`);
}

const modelInput = admin.match(/<input id="model"[^>]*>/u)?.[0] ?? "";
assert.ok(modelInput, "reviewed model input is missing");
assert.ok(modelInput.includes("readonly"), "reviewed model input must stay read-only");
assert.ok(modelInput.includes(REVIEWED_MODEL), "reviewed model input must display the canonical GLM model");
assert.ok(!modelInput.includes("placeholder="), "reviewed model input must not imply a selectable model placeholder");

for (const forbidden of [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "AI_GATEWAY_TOKEN",
  "process.env",
  "fetch(",
]) {
  assert.ok(!storage.includes(forbidden), `storage model-truth boundary gained provider authority: ${forbidden}`);
}

console.log("EVAVO admin model truth contract passed.");
console.log(`- protected storage, admin projections and operator UI are canonicalized to ${REVIEWED_MODEL}`);
console.log("- the model field is read-only and cannot grant arbitrary operator model-selection authority");
console.log("- save and load paths preserve the reviewed model while Bearer auth and credentials-omit behavior remain intact");
console.log("- the retired Llama placeholder and arbitrary model payload path are absent");
