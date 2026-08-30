#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(workerRoot, "..");
const seedPath = path.join(workerRoot, "upsert-evavo.json");
const envelopePath = path.join(repositoryRoot, "docs", "evavo-workers-ai-free-tier-envelope.md");
const raw = fs.readFileSync(seedPath, "utf8");
const envelope = fs.readFileSync(envelopePath, "utf8");
const GLM_47_FLASH_REVIEWED_OUTPUT_NEURONS_PER_MILLION_TOKENS = 36_400;
const EVAVO_REVIEWED_CHAT_NEURON_ENVELOPE = 2_000;

assert.ok(raw.length > 0, "EVAVO seed must not be empty");
assert.ok(!raw.startsWith("\uFEFF"), "EVAVO seed must not contain a UTF-8 BOM");
assert.ok(!raw.includes("\r"), "EVAVO seed must use LF line endings");
assert.ok(envelope.length > 0 && !envelope.includes("\r"), "EVAVO neuron envelope documentation must be present and LF-only");

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
  allowedActionTypes: ["open_contact"],
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
  "Only mention pages or links that are present in supplied knowledge or configured contact information",
  "Never claim a lead, message or personal detail was saved, sent or shared",
  "follow-up requires an explicit visitor-controlled action",
]) {
  assert.ok(seed.tone.includes(required), `EVAVO seed tone missing: ${required}`);
}

for (const forbidden of [
  "@cf/meta/llama-3-8b-instruct",
  "@cf/meta/llama-3.2-3b-instruct",
  "https://evavo.com.au/pricing",
  "webhook",
  '"create_lead"',
  "temperature",
  "systemPrompt",
  "we saved your details",
  "your message has been sent",
]) {
  assert.ok(!raw.includes(forbidden), `EVAVO seed retained stale or unsafe material: ${forbidden}`);
}

assert.ok(seed.dailyBudget.maxRequestsPerDay > 0);
assert.ok(seed.dailyBudget.maxTokensPerDay > 0);
assert.ok(seed.maxTokens <= 1024);
assert.ok(seed.rateLimit.limit <= 12);

const pessimisticChatNeurons =
  (seed.dailyBudget.maxTokensPerDay / 1_000_000) *
  GLM_47_FLASH_REVIEWED_OUTPUT_NEURONS_PER_MILLION_TOKENS;
assert.ok(
  pessimisticChatNeurons <= EVAVO_REVIEWED_CHAT_NEURON_ENVELOPE,
  `EVAVO seed exceeds reviewed chat neuron envelope: ${pessimisticChatNeurons}`,
);
assert.equal(
  seed.ragMode,
  "simple",
  "EVAVO public seed must not add embedding inference to the reviewed chat neuron envelope",
);

for (const required of [
  "Reviewed: **2026-08-29**",
  "10,000 Neurons per day",
  "5,500 neurons per million input tokens",
  "36,400 neurons per million output tokens",
  "45,000 / 1,000,000 × 36,400 = 1,638 neurons/day",
  "2,000 neurons/day",
  "`ragMode: simple`",
  "Workers AI free allocation is account-wide",
  "must **not** claim",
]) {
  assert.ok(envelope.includes(required), `EVAVO neuron envelope documentation missing: ${required}`);
}

console.log("EVAVO reviewed seed policy passed.");
console.log("- recovery seed uses GLM-4.7-Flash and the current bounded chat defaults");
console.log("- public knowledge URLs point only at current EVAVO pages");
console.log("- request/token budgets are explicit rather than unlimited");
console.log(`- pessimistic 45k-token chat envelope is ${pessimisticChatNeurons.toFixed(0)} reviewed neurons/day`);
console.log("- the dated pricing snapshot and account-wide caveat are bound into the executable seed guard");
console.log("- this bot-level envelope does not claim or reserve the account-wide Workers AI free allocation");
console.log("- source/link wording is evidence-bound and cannot invent navigation targets");
console.log("- model text cannot claim follow-up data was saved, sent or shared");
console.log("- model actions are presentation-only open_contact; lead persistence remains visitor controlled through the explicit hardened lead route");
console.log("- retired Llama, pricing-page, create_lead, webhook and legacy prompt fields remain absent");
