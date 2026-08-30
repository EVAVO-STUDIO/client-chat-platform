#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verifierPath = path.join(root, "scripts", "verify-evavo-activation.mjs");
const orchestratorGuardPath = path.join(
  root,
  "scripts",
  "check-reviewed-evavo-activation-orchestrator.mjs",
);
const packagePath = path.join(root, "package.json");

for (const file of [verifierPath, orchestratorGuardPath, packagePath]) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile(), `${file} must be a regular file`);
  assert.ok(!stat.isSymbolicLink(), `${file} must not be a symlink`);
}

const verifier = fs.readFileSync(verifierPath, "utf8");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

for (const token of [
  'const EXPECTED_RUNTIME = "client_chat_active_runtime_v2";',
  'const EXPECTED_SECURITY_CONTRACT = "client_chat_hardened_router_v2";',
  'const APPROVED_ORIGIN = "https://evavo.com.au";',
  "const REQUEST_TIMEOUT_MS = 20_000;",
  "const MAX_RESPONSE_BYTES = 128 * 1024;",
  'new URL("/health", `${origin}/`)',
  'new URL("/api/chat", `${origin}/`)',
  "Origin: APPROVED_ORIGIN",
  'Referer: `${APPROVED_ORIGIN}/`',
  'serverResponse.status !== 401',
  'serverChat.error !== "bot_key_required"',
  'response.headers.get("x-evavo-chat-runtime") !== EXPECTED_RUNTIME',
  'JSON.stringify(browserChat).includes("@cf/")',
  'SENSITIVE_KEYS.has(key)',
  "function assertNoImplicitLeadAction(value)",
  'action.type === "create_lead" || action.type === "webhook"',
  'fail("EVAVO_CHAT_IMPLICIT_LEAD_ACTION_EXPOSED")',
  "assertNoImplicitLeadAction(browserChat)",
  'console.log("- first-party origin succeeds without a bot key")',
  'console.log("- no-origin server request remains bot-key protected")',
  'console.log("- public model response cannot expose create_lead or webhook actions")',
]) {
  assert.ok(verifier.includes(token), `activation verifier missing: ${token}`);
}

for (const forbidden of [
  "EVAVO_CHAT_ADMIN_TOKEN",
  "APPLY_EVAVO_REVIEWED_SEED",
  "/admin/",
  "wrangler",
  "KVNamespace",
  "BOT_CONFIG",
  "KB_CACHE",
  "process.env.CHAT_BOT_KEY",
  '"x-bot-key"',
  "npm run deploy",
  "npm run apply:evavo-seed",
]) {
  assert.ok(!verifier.includes(forbidden), `activation verifier gained mutation/secret authority: ${forbidden}`);
}

const orchestratorGuard = spawnSync(process.execPath, [orchestratorGuardPath], {
  encoding: "utf8",
  cwd: root,
});
if (orchestratorGuard.status !== 0) {
  throw new Error(
    orchestratorGuard.stderr ||
      orchestratorGuard.stdout ||
      "Windows activation orchestrator guard failed",
  );
}

assert.equal(
  pkg.scripts?.["verify:evavo-activation"],
  "node scripts/verify-evavo-activation.mjs",
  "root activation verifier command drifted",
);
assert.equal(
  pkg.scripts?.check,
  "npm --prefix worker run check",
  "canonical root check command changed",
);
assert.equal(
  pkg.scripts?.deploy,
  "npm --prefix worker run deploy",
  "canonical root deploy command changed",
);
assert.equal(
  pkg.scripts?.["apply:evavo-seed"],
  "node scripts/apply-reviewed-evavo-seed.mjs",
  "reviewed seed mutation command changed",
);
assert.ok(
  !pkg.scripts.deploy.includes("verify:evavo-activation") &&
    !pkg.scripts.deploy.includes("apply:evavo-seed"),
  "deploy must not couple verification or seed mutation",
);

console.log("EVAVO read-only activation verifier contract passed.");
console.log("- approved-origin chat is verified without a bot key");
console.log("- no-origin server chat remains bot-key protected");
console.log("- runtime/security contracts, bounded responses and secret redaction are verified");
console.log("- public browser responses must not expose model-generated create_lead or webhook actions");
console.log("- Windows activation orchestration safety is validated without executing deployment");
console.log("- no admin token, KV mutation, seed apply or deploy authority is present in the verifier");
