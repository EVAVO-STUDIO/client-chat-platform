#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = path.join(root, "scripts", "apply-reviewed-evavo-seed.mjs");
const seedPath = path.join(root, "worker", "upsert-evavo.json");
const helper = fs.readFileSync(helperPath, "utf8");
const seedRaw = fs.readFileSync(seedPath, "utf8");
const seed = JSON.parse(seedRaw);

assert.ok(helper.length > 0 && !helper.includes("\r"), "reviewed seed apply helper must be LF-only");
assert.ok(seedRaw.length > 0 && !seedRaw.includes("\r"), "reviewed EVAVO seed must be LF-only");

for (const required of [
  'const EXPECTED_CONFIRMATION = "APPLY_EVAVO_REVIEWED_SEED";',
  'const EXPECTED_RUNTIME = "client_chat_active_runtime_v2";',
  'const EXPECTED_SECURITY_CONTRACT = "client_chat_hardened_router_v2";',
  'const EXPECTED_MODEL = "@cf/zai-org/glm-4.7-flash";',
  "const MAX_RESPONSE_BYTES = 128 * 1024;",
  "const REQUEST_TIMEOUT_MS = 20_000;",
  'envText("EVAVO_CHAT_WORKER_URL")',
  'envText("EVAVO_CHAT_ADMIN_TOKEN")',
  'envText("EVAVO_CHAT_APPLY_SEED_CONFIRM")',
  'throw new Error(`EVAVO_CHAT_APPLY_SEED_CONFIRM_REQUIRED:${EXPECTED_CONFIRMATION}`)',
  'parsed.protocol !== "https:"',
  'local && parsed.protocol === "http:"',
  "parsed.username",
  "parsed.password",
  "parsed.search",
  "parsed.hash",
  'authorization: `Bearer ${token}`',
  'redirect: "error"',
  'referrerPolicy: "no-referrer"',
  'cache: "no-store"',
  'new URL("/health", `${origin}/`)',
  'health.securityContract, EXPECTED_SECURITY_CONTRACT',
  'healthResponse.headers.get("x-evavo-chat-runtime"), EXPECTED_RUNTIME',
  'adminPost(origin, token, "/admin/upsert", seed)',
  'adminPost(origin, token, "/admin/get", { botId: "evavo" })',
  'adminPost(origin, token, "/admin/kb/refresh", { botId: "evavo" })',
  'assert.equal(attempted, seed.knowledgeUrls.length);',
  'assert.equal(failed, 0, "approved knowledge refresh was partial");',
  'assert.equal(refreshed, attempted, "approved knowledge refresh did not complete");',
  'assert.equal(cfg.model, EXPECTED_MODEL);',
  'assert.equal(cfg.maxTokens, 320);',
  'assert.equal(cfg.maxTurns, 8);',
  'assert.equal(cfg.maxCharsPerMessage, 1400);',
  'assert.equal(cfg.ragMode, "simple");',
  'Object.prototype.hasOwnProperty.call(cfg, "botKey")',
  'console.log("- administrator token and raw bot configuration were not printed")',
]) {
  assert.ok(helper.includes(required), `reviewed seed apply helper missing: ${required}`);
}

for (const forbidden of [
  '"x-admin-token"',
  "localStorage",
  "sessionStorage",
  "wrangler deploy",
  "npx wrangler",
  "BOT_CONFIG.put",
  "KVNamespace",
  "?token=",
  "?adminToken=",
  "console.log(token",
  "console.error(token",
  "console.log(seed)",
  "console.log(cfg)",
  "process.argv",
]) {
  assert.ok(!helper.includes(forbidden), `reviewed seed apply helper contains forbidden authority/material: ${forbidden}`);
}

assert.equal(seed.botId, "evavo");
assert.equal(seed.model, "@cf/zai-org/glm-4.7-flash");
assert.equal(seed.maxTokens, 320);
assert.equal(seed.maxTurns, 8);
assert.equal(seed.maxCharsPerMessage, 1400);
assert.equal(seed.ragMode, "simple");
assert.equal(seed.ragMaxUrlsPerRequest, 1);
assert.equal(seed.dailyBudget.maxRequestsPerDay, 45);
assert.equal(seed.dailyBudget.maxTokensPerDay, 45000);

const upsertIndex = helper.indexOf('adminPost(origin, token, "/admin/upsert", seed)');
const getIndex = helper.indexOf('adminPost(origin, token, "/admin/get", { botId: "evavo" })');
const refreshIndex = helper.indexOf('adminPost(origin, token, "/admin/kb/refresh", { botId: "evavo" })');
assert.ok(upsertIndex >= 0 && getIndex > upsertIndex && refreshIndex > getIndex, "seed apply mutation/readback/cache-refresh order is invalid");

console.log("EVAVO reviewed seed apply helper policy passed.");
console.log("- production mutation requires explicit target, admin token and confirmation environment values");
console.log("- the target must prove the hardened security contract and active runtime header before mutation");
console.log("- only reviewed upsert, redacted readback and approved cache refresh admin routes are used");
console.log("- partial knowledge refresh fails closed");
console.log("- no Wrangler, direct KV, legacy admin header or secret-in-URL authority is present");
console.log("- administrator token and full configuration are never intentionally logged");
