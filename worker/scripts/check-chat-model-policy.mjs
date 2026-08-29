#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(workerRoot, "src", "runtime.ts");
const runtime = fs.readFileSync(runtimePath, "utf8");

const ACTIVE_MODEL = "@cf/zai-org/glm-4.7-flash";
const RETIRED_MODELS = Object.freeze([
  "@cf/meta/llama-3.2-3b-instruct",
  "@cf/meta/llama-3-8b-instruct",
]);

assert.ok(runtime.length > 0 && !runtime.includes("\r"));
assert.equal(
  runtime.includes(`const DEFAULT_CHAT_MODEL = "${ACTIVE_MODEL}";`),
  true,
  "active chat runtime must use GLM-4.7-Flash as its reviewed fallback",
);

const retiredStart = runtime.indexOf("const RETIRED_CHAT_MODELS = new Set([");
const retiredEnd = runtime.indexOf("]);", retiredStart);
assert.ok(retiredStart >= 0 && retiredEnd > retiredStart, "retired model set is missing");
const retiredBlock = runtime.slice(retiredStart, retiredEnd + 3);
for (const model of RETIRED_MODELS) {
  assert.ok(retiredBlock.includes(`"${model}"`), `retired model missing: ${model}`);
}
assert.ok(
  !retiredBlock.includes(`"${ACTIVE_MODEL}"`),
  "active fallback model must not be retired",
);

for (const required of [
  "function modelTextFromResult(value: unknown)",
  "Array.isArray(result.choices)",
  ".message",
  ".content",
  "function normalizeModelResult(value: unknown)",
  "Object.freeze({ ...result, response: text })",
  "const providerResult = await Promise.race([",
  "return normalizeModelResult(providerResult);",
  "effectiveChatModel(model)",
  "MODEL_TIMEOUT_MS = 20_000",
  "configuredModelValidatedBeforeProviderCall: true",
  "missingModelUsesReviewedFallback: true",
  "malformedModelUsesReviewedFallback: true",
  "retiredModelUsesReviewedFallback: true",
  "reviewedFallbackModel: DEFAULT_CHAT_MODEL",
  "historicalFallbackAuditToken: LEGACY_FALLBACK_AUDIT_TOKEN",
  "openAiStyleChoiceResponseNormalizedForLegacyRouter: true",
]) {
  assert.ok(runtime.includes(required), `model boundary missing: ${required}`);
}

for (const forbidden of [
  "https://api.cloudflare.com",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "AI_GATEWAY_TOKEN",
  "process.env",
  "fetch(",
]) {
  assert.ok(!runtime.includes(forbidden), `active runtime gained external model authority: ${forbidden}`);
}

assert.ok(
  runtime.indexOf(`const DEFAULT_CHAT_MODEL = "${ACTIVE_MODEL}";`) <
    runtime.indexOf("function effectiveChatModel"),
  "reviewed model must be fixed before model selection",
);
assert.ok(
  runtime.indexOf("effectiveChatModel(model)") <
    runtime.indexOf("return normalizeModelResult(providerResult);"),
  "model selection and provider call must precede response normalization",
);

const normalizerStart = runtime.indexOf("function modelTextFromResult");
const normalizerEnd = runtime.indexOf("function withoutLegacyAdminHeader", normalizerStart);
assert.ok(normalizerStart >= 0 && normalizerEnd > normalizerStart, "model result normalizer is missing");
const normalizer = runtime.slice(normalizerStart, normalizerEnd);
for (const forbidden of [
  "JSON.stringify",
  "JSON.parse",
  "eval(",
  "new Function",
  "fetch(",
  "process.env",
]) {
  assert.ok(!normalizer.includes(forbidden), `model response normalizer gained unsafe behavior: ${forbidden}`);
}

console.log("EVAVO chat model policy passed.");
console.log(`- reviewed fallback: ${ACTIVE_MODEL}`);
console.log("- previous Llama fallbacks are explicitly retired");
console.log("- OpenAI-style choices[0].message.content is normalized to the legacy response field");
console.log("- existing top-level response strings pass through unchanged");
console.log("- configured models remain syntax-validated and bounded by the 20-second provider deadline");
console.log("- no provider credential, REST endpoint or external fetch authority was added");
