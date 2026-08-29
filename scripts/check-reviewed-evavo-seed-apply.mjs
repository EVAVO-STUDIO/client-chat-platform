#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = path.join(root, "scripts", "apply-reviewed-evavo-seed.mjs");
const seedPath = path.join(root, "worker", "upsert-evavo.json");
const packagePath = path.join(root, "package.json");
const helper = fs.readFileSync(helperPath, "utf8");
const seedRaw = fs.readFileSync(seedPath, "utf8");
const packageRaw = fs.readFileSync(packagePath, "utf8");
const seed = JSON.parse(seedRaw);
const rootPackage = JSON.parse(packageRaw);

assert.ok(helper.length > 0 && !helper.includes("\r"), "reviewed seed apply helper must be LF-only");
assert.ok(seedRaw.length > 0 && !seedRaw.includes("\r"), "reviewed EVAVO seed must be LF-only");
assert.ok(packageRaw.length > 0 && !packageRaw.includes("\r"), "root package must remain LF-only");

assert.equal(rootPackage.scripts?.check, "npm --prefix worker run check");
assert.equal(rootPackage.scripts?.deploy, "npm --prefix worker run deploy");
assert.equal(
  rootPackage.scripts?.["apply:evavo-seed"],
  "node scripts/apply-reviewed-evavo-seed.mjs",
);
assert.ok(
  !String(rootPackage.scripts?.deploy || "").includes("apply:evavo-seed"),
  "Worker deployment must never implicitly apply the EVAVO seed",
);

for (const required of [
  'const EXPECTED_CONFIRMATION = "APPLY_EVAVO_REVIEWED_SEED";',
  'const EXPECTED_RUNTIME = "client_chat_active_runtime_v2";',
  'const EXPECTED_SECURITY_CONTRACT = "client_chat_hardened_router_v2";',
  'const EXPECTED_MODEL = "@cf/zai-org/glm-4.7-flash";',
  "const MAX_RESPONSE_BYTES = 128 * 1024;",
  "const REQUEST_TIMEOUT_MS = 20_000;",
  "function fail(code)",
  "function requireEqual(actual, expected, code)",
  "function requireJsonEqual(actual, expected, code)",
  'envText("EVAVO_CHAT_WORKER_URL")',
  'envText("EVAVO_CHAT_ADMIN_TOKEN")',
  'envText("EVAVO_CHAT_APPLY_SEED_CONFIRM")',
  'fail(`EVAVO_CHAT_APPLY_SEED_CONFIRM_REQUIRED:${EXPECTED_CONFIRMATION}`)',
  'parsed.protocol !== "https:"',
  'local && parsed.protocol === "http:"',
  "parsed.username",
  "parsed.password",
  "parsed.search",
  "parsed.hash",
  "async function fetchBoundedJson(url, init)",
  'controller.abort("evavo-seed-deadline")',
  "const response = await fetch(url, {",
  "const value = await readBoundedJson(response);",
  'if (controller.signal.aborted) fail("EVAVO_CHAT_REQUEST_TIMEOUT")',
  "clearTimeout(timer);",
  'authorization: `Bearer ${token}`',
  'redirect: "error"',
  'referrerPolicy: "no-referrer"',
  'cache: "no-store"',
  'new URL("/health", `${origin}/`)',
  'health.securityContract,\n    EXPECTED_SECURITY_CONTRACT',
  'healthResponse.headers.get("x-evavo-chat-runtime"),\n    EXPECTED_RUNTIME',
  'adminPost(origin, token, "/admin/upsert", seed)',
  'adminPost(origin, token, "/admin/get", { botId: "evavo" })',
  'adminPost(origin, token, "/admin/kb/refresh", {',
  '"EVAVO_CHAT_KNOWLEDGE_REFRESH_SCOPE_MISMATCH"',
  '"EVAVO_CHAT_KNOWLEDGE_REFRESH_PARTIAL"',
  '"EVAVO_CHAT_KNOWLEDGE_REFRESH_INCOMPLETE"',
  'requireEqual(cfg.model, EXPECTED_MODEL, "EVAVO_CHAT_CONFIG_MODEL_MISMATCH")',
  'requireEqual(cfg.maxTokens, 320, "EVAVO_CHAT_CONFIG_MAX_TOKENS_MISMATCH")',
  'requireEqual(cfg.maxTurns, 8, "EVAVO_CHAT_CONFIG_MAX_TURNS_MISMATCH")',
  'requireEqual(cfg.ragMode, "simple", "EVAVO_CHAT_CONFIG_RAG_MODE_MISMATCH")',
  'Object.prototype.hasOwnProperty.call(cfg, "botKey")',
  'seed.dailyBudget.maxRequestsPerDay',
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
  "assert.deepEqual",
  "assert.strictEqual",
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

const healthIndex = helper.indexOf('new URL("/health", `${origin}/`)');
const upsertIndex = helper.indexOf('adminPost(origin, token, "/admin/upsert", seed)');
const getIndex = helper.indexOf('adminPost(origin, token, "/admin/get", { botId: "evavo" })');
const refreshIndex = helper.indexOf('adminPost(origin, token, "/admin/kb/refresh", {');
assert.ok(
  healthIndex >= 0 &&
    upsertIndex > healthIndex &&
    getIndex > upsertIndex &&
    refreshIndex > getIndex,
  "seed apply health/mutation/readback/cache-refresh order is invalid",
);

const boundedFetchStart = helper.indexOf("async function fetchBoundedJson");
const boundedFetchEnd = helper.indexOf("async function adminPost", boundedFetchStart);
assert.ok(boundedFetchStart >= 0 && boundedFetchEnd > boundedFetchStart, "whole-operation fetch boundary is missing");
const boundedFetch = helper.slice(boundedFetchStart, boundedFetchEnd);
assert.ok(
  boundedFetch.indexOf("const response = await fetch") <
    boundedFetch.indexOf("const value = await readBoundedJson(response)"),
  "response body must be read before the operation deadline is released",
);
assert.ok(
  boundedFetch.indexOf("const value = await readBoundedJson(response)") <
    boundedFetch.indexOf("clearTimeout(timer)"),
  "response body read escaped the shared operation deadline",
);

console.log("EVAVO reviewed seed apply helper policy passed.");
console.log("- canonical check/deploy commands remain unchanged while apply:evavo-seed is explicit and separate");
console.log("- production mutation requires explicit target, admin token and confirmation environment values");
console.log("- the target must prove the hardened security contract and active runtime header before mutation");
console.log("- one 20-second deadline covers headers and the bounded streamed response body");
console.log("- only reviewed upsert, redacted readback and approved cache refresh admin routes are used");
console.log("- partial knowledge refresh fails closed");
console.log("- comparison failures use stable codes rather than dumping returned configuration objects");
console.log("- no Wrangler, direct KV, legacy admin header or secret-in-URL authority is present");
console.log("- administrator token and full configuration are never intentionally logged");
