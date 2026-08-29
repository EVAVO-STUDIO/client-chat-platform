#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verifierPath = path.join(root, "scripts", "verify-evavo-activation.mjs");
const packagePath = path.join(root, "package.json");

for (const file of [verifierPath, packagePath]) {
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
  'console.log("- first-party origin succeeds without a bot key")',
  'console.log("- no-origin server request remains bot-key protected")',
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
console.log("- no admin token, KV mutation, seed apply or deploy authority is present");
