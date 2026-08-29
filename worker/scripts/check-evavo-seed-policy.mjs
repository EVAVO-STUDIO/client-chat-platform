#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seedPath = path.join(workerRoot, "upsert-evavo.json");
const raw = fs.readFileSync(seedPath, "utf8");

assert.ok(raw.length > 0, "EVAVO seed must not be empty");
assert.ok(!raw.startsWith("\uFEFF"), "EVAVO seed must not contain a UTF-8 BOM");
assert.ok(!raw.includes("\r"), "EVAVO seed must use LF line endings");

const seed = JSON.parse(raw);
assert.deepEqual(Object.keys(seed).sort(), [
  "actions",
  "allowedOrigins",
  "botId",
  "contactUrl",
  "dailyBudget",
  "knowledgeUrls",
  "leadMode",
  "maxCharsPerMessage",
  "maxTokens",
  "maxTurns",
  "model",
  "qualifyingQuestions",
  "ragCacheTtlSeconds",
  "ragEnabled",
  "ragMaxUrlsPerRequest",
  "ragMode",
  "rateLimit",
  "siteName",
  "tone",
]);

assert.equal(seed.botId, "evavo");
assert.equal(seed.siteName, "EVAVO Studio");
assert.equal(seed.contactUrl, "https://evavo.com.au/contact");
assert.deepEqual(seed.allowedOrigins, [
  "https://evavo.com.au",
  "https://www.evavo.com.au",
]);
assert.equal(seed.model, "@cf/zai-org/glm-4.7-flash");
assert.equal(seed.maxTokens, 320);
assert.equal(seed.maxTurns, 8);
assert.equal(seed.maxCharsPerMessage, 1400);
assert.equal(seed.leadMode, "balanced");
assert.equal(seed.ragEnabled, true);
assert.equal(seed.ragMode, "simple");
assert.equal(seed.ragMaxUrlsPerRequest, 1);
assert.equal(seed.ragCacheTtlSeconds, 86400);
assert.deepEqual(seed.knowledgeUrls, [
  "https://evavo.com.au/services",
  "https://evavo.com.au/work",
  "https://evavo.com.au/about",
  "https://evavo.com.au/contact",
]);
assert.deepEqual(seed.rateLimit, { limit: 5, windowSeconds: 60 });
assert.deepEqual(seed.dailyBudget, {
  maxRequestsPerDay: 45,
  maxTokensPerDay: 45000,
});
assert.deepEqual(seed.actions, {
  actionsEnabled: true,
  allowedActionTypes: ["open_contact", "create_lead"],
});

for (const required of [
  "Answer the question first",
  "without generic greetings",
  "Never invent pricing",
  "timelines",
  "policies",
  "SLAs",
  "compliance claims",
  "client facts",
]) {
  assert.ok(seed.tone.includes(required), `EVAVO seed tone missing: ${required}`);
}

for (const forbidden of [
  "@cf/meta/llama-3-8b-instruct",
  "@cf/meta/llama-3.2-3b-instruct",
  "https://evavo.com.au/pricing",
  "webhook",
  "temperature",
  "systemPrompt",
]) {
  assert.ok(!raw.includes(forbidden), `EVAVO seed retained stale or unsafe material: ${forbidden}`);
}

assert.ok(seed.dailyBudget.maxRequestsPerDay > 0);
assert.ok(seed.dailyBudget.maxTokensPerDay > 0);
assert.ok(seed.maxTokens <= 1024);
assert.ok(seed.rateLimit.limit <= 12);

console.log("EVAVO reviewed seed policy passed.");
console.log("- recovery seed uses GLM-4.7-Flash and the current bounded chat defaults");
console.log("- public knowledge URLs point only at current EVAVO pages");
console.log("- request/token budgets are explicit rather than unlimited");
console.log("- contact/follow-up actions remain available only through the hardened consent boundary");
console.log("- retired Llama, pricing-page, webhook and legacy prompt fields remain absent");
