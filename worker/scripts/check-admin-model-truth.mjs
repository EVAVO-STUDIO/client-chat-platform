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

const admin = fs.readFileSync(adminPath, "utf8");
const storage = fs.readFileSync(storagePath, "utf8");
const policy = fs.readFileSync(policyPath, "utf8");
const REVIEWED_MODEL = "@cf/zai-org/glm-4.7-flash";
const RETIRED_MODEL = "@cf/meta/llama-3.2-3b-instruct";

assert.ok(admin.length > 0 && !admin.includes("\r"));
assert.ok(storage.length > 0 && !storage.includes("\r"));
assert.ok(policy.length > 0 && !policy.includes("\r"));

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

// The server boundary is authoritative today. Until the admin surface is made
// read-only for model choice, its stale placeholder must remain explicit test
// debt rather than being mistaken for a supported model selection path.
assert.ok(
  admin.includes(`placeholder="${RETIRED_MODEL}"`),
  "admin model field changed without updating the reviewed admin-model truth contract",
);
assert.ok(
  admin.includes('model: text("model") || undefined'),
  "admin still needs an explicit reviewed-model UI migration before model choice can be removed",
);

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
console.log(`- protected storage and admin projections are canonicalized to ${REVIEWED_MODEL}`);
console.log("- server-side model policy remains authoritative regardless of stale form input");
console.log("- the remaining operator-UI model field is explicitly tracked as migration debt, not supported authority");
