#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(workerRoot, "..");
const errors = [];

function readFrom(root, relativePath) {
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

function segment(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0 || to <= from) {
    errors.push(`Could not resolve source segment: ${start} -> ${end}`);
    return "";
  }
  return source.slice(from, to);
}

const security = readFrom(workerRoot, "src/security.ts");
const configBoundary = readFrom(workerRoot, "src/configBoundary.ts");
const hardened = readFrom(workerRoot, "src/hardened.ts");
const legacy = readFrom(workerRoot, "src/index.ts");
const wrangler = readFrom(workerRoot, "wrangler.jsonc");
const workerPackageSource = readFrom(workerRoot, "package.json");
const workerLockSource = readFrom(workerRoot, "package-lock.json");
const rootPackageSource = readFrom(repositoryRoot, "package.json");
const admin = readFrom(repositoryRoot, "admin/index.html");
const widget = readFrom(repositoryRoot, "widget/embed.js");

let workerPackage = {};
let workerLock = {};
let rootPackage = {};
try { workerPackage = JSON.parse(workerPackageSource); } catch { errors.push("worker/package.json must remain valid JSON"); }
try { workerLock = JSON.parse(workerLockSource); } catch { errors.push("worker/package-lock.json must remain valid JSON"); }
try { rootPackage = JSON.parse(rootPackageSource); } catch { errors.push("package.json must remain valid JSON"); }

requireTokens("Wrangler activation", wrangler, [
  '"main": "src/hardened.ts"',
  '"global_fetch_strictly_public"',
  '"nodejs_compat"',
  '"preview_urls": false',
  '"observability"',
]);
forbidTokens("Wrangler activation", wrangler, ['"main": "src/index.ts"']);

requireTokens("Network and request security", security, [
  'CHAT_SECURITY_CONTRACT = "client_chat_security_v2"',
  "ADMIN_REQUEST_MAX_BYTES = 64 * 1024",
  "CHAT_REQUEST_MAX_BYTES = 128 * 1024",
  "BLOCKED_JSON_KEYS",
  "configuredAdminTokenAllowed",
  "boundedSecretEqual",
  'authorization.startsWith("Bearer ")',
  'crypto.subtle.digest("SHA-256"',
  "normalizePublicHttpsUrl",
  "normalizeAllowedOrigin",
  'source.includes("*")',
  'redirect: "manual"',
  "responseLooksBinary",
  "readResponseBody(",
  "deadline",
  "controller.abort()",
  "finally",
  "clearTimeout(timeout)",
  "dnsRebindingMitigatedByRuntimePublicFetchFlag: true",
  "fullOperationTimeoutRequired: true",
  "dormantWebhookHelperPresent: false",
]);
forbidTokens("Network and request security", security, [
  "postPublicWebhook",
  "WEBHOOK_TIMEOUT_MS",
  'redirect: "follow"',
  "x-admin-token",
]);

requireTokens("Bot configuration boundary", configBoundary, [
  'BOT_CONFIG_BOUNDARY_CONTRACT =\n  "client_chat_bot_config_boundary_v2"',
  'KNOWLEDGE_CACHE_RECORD_VERSION =\n  "client_chat_cached_knowledge_v1"',
  "sanitizeUpsertConfig",
  "safeStoredNetworkConfig",
  "browserOriginDecision",
  "buildSafeChatConfig",
  "refreshBotKnowledge",
  "knowledgeCacheKey",
  '`kb:v2:${await sha256Hex(url)}`',
  "exactCacheRecordShape",
  "verifiedCachedKnowledge",
  "bodySha256",
  "sourceUrl",
  "finalUrl",
  "cacheRecordDigestVerifiedBeforeUse: true",
  "liveRagFetchFromPublicChatAllowed: false",
  "cachedWebsiteInstructionsTrusted: false",
  'botKey: ""',
  'allowedActionTypes: ["none"]',
]);
forbidTokens("Bot configuration boundary", configBoundary, [
  "webhookUrl:",
  "webhookAuthHeader:",
  "webhookSecret:",
  'item === "webhook"',
]);
const chatConfigSegment = segment(
  configBoundary,
  "export async function buildSafeChatConfig",
  "export function withBotConfigOverride",
);
forbidTokens("Public chat cache construction", chatConfigSegment, [
  "fetchBoundedPublicText(",
  "await fetch(",
]);
const refreshSegment = segment(
  configBoundary,
  "export async function refreshBotKnowledge",
  "export const botConfigBoundaryPosture",
);
requireTokens("Authenticated knowledge refresh", refreshSegment, [
  "fetchBoundedPublicText(",
  "knowledgeCacheKey(url)",
  "JSON.stringify(record)",
  "expirationTtl: ttl",
]);

requireTokens("Hardened router", hardened, [
  'import legacyWorker, { type Env as LegacyEnv } from "./index"',
  'from "./configBoundary"',
  "ADMIN_ALLOWED_ORIGINS?: string",
  "readBoundedResponseText",
  "sanitizedLegacyResponse",
  "sanitizeChatPayload",
  'value.botKey !== undefined',
  "Object.keys(message).sort()",
  "boundedSecretEqual(",
  "browserOriginDecision",
  "buildSafeChatConfig",
  "withBotConfigOverride",
  "refreshBotKnowledge",
  'value.confirm !== "DELETE_BOT"',
  'value.confirm !== "DELETE_ALL_BOTS"',
  'headers.delete("x-admin-token")',
  "configuredAdminTokenAllowed",
  "isAdminRequestAuthorized",
  'securityContract: "client_chat_hardened_router_v2"',
  "publicChatNetworkFetch: false",
  "legacyRouterDirectlyDeployed: false",
  "publicChatNetworkFetchAllowed: false",
  "unexpectedErrorsSanitized: true",
]);
forbidTokens("Hardened router", hardened, [
  'request.headers.get("x-admin-token")',
  "request.json()",
  "response.text()",
  "postPublicWebhook",
  "fetchBoundedPublicText",
]);
const handleChatSegment = segment(hardened, "async function handleChat", "export default");
forbidTokens("Public chat route", handleChatSegment, ["await fetch(", "fetchBoundedPublicText("]);
requireOrder("Public chat authorization", handleChatSegment, [
  "safeStoredNetworkConfig(config)",
  "browserOriginDecision(request, network.origins)",
  "boundedSecretEqual(",
  "buildSafeChatConfig",
  "legacyWorker.fetch",
]);

requireTokens("Legacy isolation", legacy, [
  "export default",
  "async function handleChat",
]);
if (wrangler.includes('"main": "src/index.ts"')) {
  errors.push("The legacy router must not be the Wrangler entrypoint");
}

requireTokens("Admin console", admin, [
  'type="password"',
  'id="allowedOrigins" required',
  'value="direct"',
  'id="refreshBtn"',
  'Authorization: `Bearer ${token}`',
  'credentials: "omit"',
  'referrerPolicy: "no-referrer"',
  "new TextEncoder().encode(value).byteLength",
  "redact(value",
  "Wildcards are intentionally unsupported",
  "External webhook configuration is rejected",
]);
forbidTokens("Admin console", admin, [
  "x-admin-token",
  "localStorage",
  "sessionStorage",
  'value="hard"',
  "webhookUrl",
  "webhookSecret",
  "brandHex",
  "greeting",
]);

requireTokens("Embeddable widget", widget, [
  'script.getAttribute("data-api-base")',
  'script.getAttribute("data-bot-id")',
  "attachShadow({ mode: \"open\" })",
  "input.maxLength = 2000",
  "readJsonBounded",
  "maximumBytes = 65536",
  'credentials: "omit"',
  'referrerPolicy: "no-referrer"',
  'mode: "cors"',
  'setTimeout(() => controller.abort("timeout"), 20000)',
  "event.key === \"Escape\"",
  "event.key !== \"Tab\"",
  "shadow.activeElement",
  "Do not share passwords, access credentials or confidential records.",
  "safeContactUrl",
  "registry.has(botId)",
]);
forbidTokens("Embeddable widget", widget, [
  "innerHTML",
  "insertAdjacentHTML",
  "localStorage",
  "sessionStorage",
  "data-bot-key",
  'body.botKey',
  "Authorization",
]);

const expectedWorkerScripts = {
  "check:security": "node scripts/check-security-contract.mjs",
  typecheck: "tsc -p tsconfig.json --noEmit",
  check: "npm run check:security && npm run typecheck",
  predeploy: "npm run check",
};
for (const [name, command] of Object.entries(expectedWorkerScripts)) {
  if (workerPackage.scripts?.[name] !== command) {
    errors.push(`worker/package.json script ${name} must equal: ${command}`);
  }
}
if (rootPackage.scripts?.check !== "npm --prefix worker run check") {
  errors.push("root package.json must expose check through the Worker package");
}
if (
  workerLock.name !== workerPackage.name ||
  workerLock.packages?.[""]?.name !== workerPackage.name
) {
  errors.push("Worker package and lockfile root identities must remain aligned");
}

const fixtureUrl = "https://example.com/";
const cacheKey = `kb:v2:${createHash("sha256").update(fixtureUrl).digest("hex")}`;
if (Buffer.byteLength(cacheKey, "utf8") !== 70) {
  errors.push("Hashed knowledge cache key fixture must remain exactly 70 bytes");
}

console.log(JSON.stringify({
  passed: errors.length === 0,
  repository: "EVAVO-STUDIO/client-chat-platform",
  contract: "client-chat-platform-security-contract-v2",
  activeEntrypoint: "worker/src/hardened.ts",
  legacyEntrypointActive: false,
  publicChatNetworkFetchAllowed: false,
  adminRefreshNetworkOnly: true,
  knowledgeCacheKeyBytes: Buffer.byteLength(cacheKey, "utf8"),
  exactBrowserOriginsRequired: true,
  wildcardOriginsAllowed: false,
  publicBotKeyEmbeddingAllowed: false,
  rawProviderOutputAllowed: false,
  externalWebhookExecutionAllowed: false,
  deterministicTypecheckRequired: true,
  errors,
}, null, 2));

if (errors.length) process.exitCode = 1;
