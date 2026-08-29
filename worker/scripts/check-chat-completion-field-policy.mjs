#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(workerRoot, "..");
const runtime = fs.readFileSync(path.join(workerRoot, "src", "runtime.ts"), "utf8");
const legacyRouter = fs.readFileSync(path.join(workerRoot, "src", "index.ts"), "utf8");
const policy = fs.readFileSync(path.join(repositoryRoot, "docs", "chat-model-policy.md"), "utf8");

assert.ok(runtime.length > 0 && !runtime.includes("\r"));
assert.ok(legacyRouter.length > 0 && !legacyRouter.includes("\r"));
assert.ok(policy.length > 0 && !policy.includes("\r"));

for (const required of [
  "const MODEL_CHAT_MAX_COMPLETION_TOKENS = 1_024;",
  "function boundedCompletionTokens(value: unknown): number | undefined",
  'throw new Error("model_chat_completion_limit_not_approved")',
  "function withCurrentChatCompletionField(",
  "const legacy = boundedCompletionTokens(request.max_tokens);",
  "const current = boundedCompletionTokens(request.max_completion_tokens);",
  'throw new Error("model_chat_completion_limit_ambiguous")',
  "const { max_tokens: _legacyMaxTokens, ...rest } = request;",
  "{ ...rest, max_completion_tokens: selected }",
  "const currentRequest = withCurrentChatCompletionField(request);",
  "return [{ ...currentRequest, messages }, ...args.slice(1)];",
  "chatMaxCompletionTokens: MODEL_CHAT_MAX_COMPLETION_TOKENS",
  "legacyMaxTokensTranslatedToCurrentCompletionField: true",
  "ambiguousCompletionLimitsFailClosed: true",
]) {
  assert.ok(runtime.includes(required), `completion-field runtime policy missing: ${required}`);
}

assert.ok(
  legacyRouter.includes("max_tokens: maxTokens"),
  "legacy router fixture changed; review the runtime compatibility adapter before updating this guard",
);
assert.ok(
  legacyRouter.includes("const GLOBAL_MAX_TOKENS = 1024;"),
  "legacy router output-token ceiling changed without completion-field policy review",
);

const adapterStart = runtime.indexOf("function boundedCompletionTokens");
const adapterEnd = runtime.indexOf("function withAnswerQualityPolicy", adapterStart);
assert.ok(adapterStart >= 0 && adapterEnd > adapterStart, "completion-field adapter is missing");
const adapter = runtime.slice(adapterStart, adapterEnd);
for (const forbidden of [
  "fetch(",
  "process.env",
  "localStorage",
  "sessionStorage",
  "document.cookie",
  "MODEL_CHAT_MAX_COMPLETION_TOKENS = 2_048",
  "Number.MAX_SAFE_INTEGER",
  "Infinity",
]) {
  assert.ok(!adapter.includes(forbidden), `completion-field adapter gained unsafe authority: ${forbidden}`);
}

for (const required of [
  "### Output-token parameter compatibility",
  "max_completion_tokens",
  "same 1,024-token hard ceiling",
  "removes the deprecated `max_tokens` field before provider execution",
  "conflicting legacy/current completion limits fail closed",
]) {
  assert.ok(policy.includes(required), `completion-field policy documentation missing: ${required}`);
}

console.log("EVAVO chat completion-field policy passed.");
console.log("- the legacy router may keep max_tokens internally while the provider boundary emits max_completion_tokens");
console.log("- the current GLM request preserves the same 1,024-token hard ceiling");
console.log("- invalid, oversized and conflicting completion limits fail closed before provider execution");
console.log("- embedding inference remains outside this chat-only compatibility adapter");
console.log("- no provider credential, network, storage or execution authority was added");
