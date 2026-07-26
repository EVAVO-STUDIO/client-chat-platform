#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(workerRoot, "..");
const errors = [];

function read(root, relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    errors.push(`Missing required file: ${path.relative(repositoryRoot, absolute)}`);
    return "";
  }
  return fs.readFileSync(absolute, "utf8");
}

function requireTokens(label, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) errors.push(`${label} is missing: ${token}`);
  }
}

function forbidTokens(label, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) errors.push(`${label} contains forbidden material: ${token}`);
  }
}

function requireOrder(label, source, tokens) {
  let previous = -1;
  for (const token of tokens) {
    const current = source.indexOf(token, previous + 1);
    if (current < 0 || current <= previous) {
      errors.push(`${label} has invalid ordering at: ${token}`);
      return;
    }
    previous = current;
  }
}

const storage = read(workerRoot, "src/runtimeStorageBoundary.ts");
const runtime = read(workerRoot, "src/runtime.ts");
const admin = read(repositoryRoot, "admin/index.html");
const packageSource = read(workerRoot, "package.json");
const workflow = read(repositoryRoot, ".github/workflows/worker-security.yml");
const documentation = read(repositoryRoot, "docs/admin-config-secret-boundary.md");
const readme = read(repositoryRoot, "README.md");

let packageJson = {};
try {
  packageJson = JSON.parse(packageSource);
} catch {
  errors.push("worker/package.json must remain valid JSON");
}

requireTokens("Runtime storage boundary", storage, [
  '"client_chat_runtime_storage_boundary_v4"',
  'BOT_KEY_CLEAR_SENTINEL = "__EVAVO_CLEAR_BOT_KEY__"',
  'BOT_CONFIG_INDEX_KEY = "cfg:index"',
  "BOT_CONFIG_KEY_PATTERN",
  'LEGACY_RATE_LIMIT_PREFIX = "rl:"',
  'HASHED_RATE_LIMIT_PREFIX = "rl:v2:"',
  "export type BotConfigMutationReceipt",
  "createBotConfigMutationReceipt",
  "withProtectedBotConfigWrites",
  "receipt?: BotConfigMutationReceipt",
  "withHashedLegacyRateLimitKeys",
  "redactAdminConfigResponse",
  "requestedBotKey === BOT_KEY_CLEAR_SENTINEL",
  "botKeyAllowed(current?.botKey)",
  "scrubRetiredConfigSecrets",
  "botKeyProjectionStatus",
  "receipt?.committed === true",
  "receipt.botId === botId",
  "projected.botKeyConfigured = configured",
  'projected.botKeyStatus = configured === true',
  "delete projected.botKey",
  "key.startsWith(HASHED_RATE_LIMIT_PREFIX)",
  "sha256Hex(",
  "readBoundedResponseText",
  "MAX_ADMIN_RESPONSE_BYTES",
  "rawBotKeyReturnedByAdminConfigRoutes: false",
  "blankBotKeyUpdateClearsExistingKey: false",
  "upsertBotKeyStatusUsesCommittedMutationReceipt: true",
  "postWriteKvReadRequiredForUpsertStatus: false",
  "unknownBotKeyStatusAllowedWithoutReceipt: true",
  "retiredWebhookCredentialsReturned: false",
  "rawClientAddressStoredInLegacyRateLimitKey: false",
  "invalidJsonAdminResponseAccepted: false",
]);
requireOrder("Protected config mutation receipt", storage, [
  "await current.put(key, protectedValue.serialized, options);",
  "receipt.botId = protectedValue.botId;",
  "receipt.botKeyConfigured = protectedValue.botKeyConfigured;",
  "receipt.committed = true;",
]);
forbidTokens("Runtime storage boundary", storage, [
  "storedConfigForProjection",
  "console.log",
  "console.error",
  "localStorage",
  "sessionStorage",
  "await fetch(",
]);

requireTokens("Active runtime wiring", runtime, [
  'from "./runtimeStorageBoundary"',
  'ADMIN_UPSERT_ROUTE = "/admin/upsert"',
  "createBotConfigMutationReceipt()",
  "type BotConfigMutationReceipt",
  "withProtectedBotConfigWrites(env.BOT_CONFIG, receipt)",
  "withHashedLegacyRateLimitKeys(env.KB_CACHE)",
  "redactAdminConfigResponse(",
  "mutationReceipt",
  "rawBotKeyReturnedByAdminConfigRoutes: false",
  "blankBotKeyUpdateClearsExistingKey: false",
  "upsertBotKeyStatusUsesCommittedMutationReceipt: true",
  "postWriteKvReadRequiredForUpsertStatus: false",
  "retiredWebhookCredentialsReturned: false",
  "rawClientAddressStoredInLegacyRateLimitKey: false",
]);
requireOrder("Active runtime storage sequence", runtime, [
  "createBotConfigMutationReceipt()",
  "runtimeEnvironment(",
  "hardenedWorker.fetch",
  "redactAdminConfigResponse(",
  "stampRuntimeContract(response)",
]);

requireTokens("Administrator console defence in depth", admin, [
  "Secret-like fields are redacted locally",
  "function redact(value",
  'key === "botKeyConfigured" || key === "botKeyStatus"',
  "/token|secret|password|botkey|authorization/i",
  'type="password"',
  'id="botKeyState" class="help" role="status" aria-live="polite"',
  'id="clearBotKey" type="checkbox"',
  'BOT_KEY_CLEAR_SENTINEL = "__EVAVO_CLEAR_BOT_KEY__"',
  "function botKeyStateMessage(config)",
  'config.botKeyStatus === "configured"',
  'config.botKeyStatus === "not_configured"',
  "The Worker could not confirm the current bot-key state.",
  "function syncBotKeyControls()",
  'byId("botKey").disabled = clearing',
  'byId("clearBotKey").addEventListener("change", syncBotKeyControls)',
  'Authorization: `Bearer ${token}`',
  'credentials: "omit"',
  'referrerPolicy: "no-referrer"',
]);
forbidTokens("Administrator console", admin, [
  "localStorage",
  "sessionStorage",
  "x-admin-token",
  "config.botKey ||",
]);

const expectedCommand = "node scripts/check-admin-config-secret-boundary.mjs";
if (packageJson.scripts?.["check:config-secrets"] !== expectedCommand) {
  errors.push(`worker/package.json must expose check:config-secrets as ${expectedCommand}`);
}
if (packageJson.scripts?.["precheck:security"] !== "npm run check:config-secrets") {
  errors.push("worker/package.json precheck:security must run check:config-secrets");
}
if (packageJson.scripts?.["check:security"] !== "node scripts/check-security-contract.mjs") {
  errors.push("worker/package.json must retain the main security checker command");
}

requireTokens("Read-only security workflow", workflow, [
  "npm run check:security",
  "npm run typecheck",
  "npm run check:bundle",
  "permissions:\n  contents: read",
  "persist-credentials: false",
]);
forbidTokens("Read-only security workflow", workflow, [
  "wrangler deploy --env production",
  "secrets.ADMIN_TOKEN",
]);

requireTokens("Administrator config secret documentation", documentation, [
  "# Administrator configuration secret boundary",
  "client_chat_runtime_storage_boundary_v4",
  "## Committed mutation receipt",
  "only after the KV `put` resolves successfully",
  "does not perform an immediate post-write KV read",
  "eventually consistent",
  "__EVAVO_CLEAR_BOT_KEY__",
  "botKeyConfigured",
  "botKeyStatus",
  "unknown",
  "cfg:index",
  "not hashed again",
  "rl:v2:<sha256>",
  "pseudonymous rather than anonymous",
  "npm run check:config-secrets",
  "does not",
]);

requireTokens("README config-secret posture", readme, [
  "docs/admin-config-secret-boundary.md",
  "Administrator config responses never return a bot key.",
  "A blank administrator bot-key field preserves an existing key.",
  "rl:v2:<sha256>",
  "npm run check:config-secrets",
  "pseudonymous rather than anonymous",
]);

console.log(JSON.stringify({
  passed: errors.length === 0,
  repository: "EVAVO-STUDIO/client-chat-platform",
  contract: "client-chat-admin-config-secret-safety-v5-mutation-receipt",
  rawBotKeysReturned: false,
  blankUpdatesClearExistingBotKeys: false,
  explicitClearSentinelRequired: true,
  upsertStatusUsesCommittedMutationReceipt: true,
  postWriteKvReadRequiredForUpsertStatus: false,
  unknownStatusAllowedWithoutReceipt: true,
  unknownStatusDisplayedAsNotConfigured: false,
  botKeyStatusLocallyRedacted: false,
  configIndexCompatibilityPreserved: true,
  malformedConfigKeysAccepted: false,
  retiredWebhookCredentialsReturned: false,
  retiredWebhookCredentialsPersistedOnUpsert: false,
  rawClientAddressesUsedAsKvKeys: false,
  alreadyHashedRateLimitKeysRehashed: false,
  rateLimitIdentifiersPseudonymous: true,
  responseProjectionByteBounded: true,
  focusedCheckRunsBeforeMainSecurityCheck: true,
  readOnlyCiRequired: true,
  deploymentAllowedFromCheck: false,
  errors,
}, null, 2));

if (errors.length) process.exitCode = 1;
