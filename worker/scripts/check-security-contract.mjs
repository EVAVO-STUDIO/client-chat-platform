#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
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

function segment(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0 || to <= from) {
    errors.push(`Could not resolve source segment: ${start} -> ${end}`);
    return "";
  }
  return source.slice(from, to);
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

const sources = {
  runtime: read(workerRoot, "src/runtime.ts"),
  hardened: read(workerRoot, "src/hardened.ts"),
  security: read(workerRoot, "src/security.ts"),
  config: read(workerRoot, "src/configBoundary.ts"),
  legacy: read(workerRoot, "src/index.ts"),
  wrangler: read(workerRoot, "wrangler.jsonc"),
  package: read(workerRoot, "package.json"),
  lock: read(workerRoot, "package-lock.json"),
  sourceSecrets: read(workerRoot, "scripts/check-source-secrets.mjs"),
  rootPackage: read(repositoryRoot, "package.json"),
  gitignore: read(repositoryRoot, ".gitignore"),
  variables: read(repositoryRoot, ".dev.vars.example"),
  workflow: read(repositoryRoot, ".github/workflows/worker-security.yml"),
  admin: read(repositoryRoot, "admin/index.html"),
  widget: read(repositoryRoot, "widget/embed.js"),
  readme: read(repositoryRoot, "README.md"),
  deploy: read(repositoryRoot, "DEPLOY.md"),
  boundary: read(repositoryRoot, "docs/security-boundary.md"),
};

let workerPackage = {};
let workerLock = {};
let rootPackage = {};
try { workerPackage = JSON.parse(sources.package); } catch { errors.push("worker/package.json must remain valid JSON"); }
try { workerLock = JSON.parse(sources.lock); } catch { errors.push("worker/package-lock.json must remain valid JSON"); }
try { rootPackage = JSON.parse(sources.rootPackage); } catch { errors.push("package.json must remain valid JSON"); }

requireTokens("Wrangler activation", sources.wrangler, [
  '"main": "src/runtime.ts"',
  '"global_fetch_strictly_public"',
  '"nodejs_compat"',
  '"preview_urls": false',
  '"observability"',
]);
forbidTokens("Wrangler activation", sources.wrangler, [
  '"main": "src/hardened.ts"',
  '"main": "src/index.ts"',
]);

requireTokens("Final runtime boundary", sources.runtime, [
  'ACTIVE_CHAT_RUNTIME_CONTRACT =\n  "client_chat_active_runtime_v1"',
  'DEFAULT_CHAT_MODEL = "@cf/meta/llama-3.2-3b-instruct"',
  '"@cf/meta/llama-3-8b-instruct"',
  "RETIRED_CHAT_MODELS",
  "MODEL_PATTERN",
  'LEGACY_ADMIN_HEADER = "x-admin-token"',
  "effectiveChatModel",
  "withoutLegacyAdminHeader",
  "headers.delete(LEGACY_ADMIN_HEADER)",
  "withModelBoundary",
  "value.call(current, effectiveChatModel(model), ...args)",
  "runtimeEnvironment",
  'headers.set("X-EVAVO-Chat-Runtime", ACTIVE_CHAT_RUNTIME_CONTRACT)',
  "hardenedWorker.fetch",
  "legacyAdminHeaderRemovedBeforeRouting: true",
  "missingModelUsesReviewedFallback: true",
  "malformedModelUsesReviewedFallback: true",
  "retiredModelUsesReviewedFallback: true",
  "rawModelConfigurationExposedInRuntimeHeaders: false",
]);
requireOrder("Final runtime request boundary", sources.runtime, [
  "withoutLegacyAdminHeader(request)",
  "runtimeEnvironment(env)",
  "hardenedWorker.fetch",
  "stampRuntimeContract(response)",
]);
forbidTokens("Final runtime boundary", sources.runtime, [
  'request.headers.get("x-admin-token")',
  "request.json()",
  "env.AI.run(",
]);

requireTokens("Request and network security", sources.security, [
  '"client_chat_security_v2"',
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
  "clearTimeout(timeout)",
  "dnsRebindingMitigatedByRuntimePublicFetchFlag: true",
  "fullOperationTimeoutRequired: true",
  "dormantWebhookHelperPresent: false",
]);
forbidTokens("Request and network security", sources.security, [
  "postPublicWebhook",
  "WEBHOOK_TIMEOUT_MS",
  'redirect: "follow"',
  "x-admin-token",
]);

requireTokens("Bot configuration boundary", sources.config, [
  '"client_chat_bot_config_boundary_v2"',
  '"client_chat_cached_knowledge_v1"',
  "sanitizeUpsertConfig",
  "safeStoredNetworkConfig",
  "browserOriginDecision",
  "buildSafeChatConfig",
  "refreshBotKnowledge",
  '`kb:v2:${await sha256Hex(url)}`',
  "exactCacheRecordShape",
  "verifiedCachedKnowledge",
  "cacheRecordDigestVerifiedBeforeUse: true",
  "liveRagFetchFromPublicChatAllowed: false",
  "cachedWebsiteInstructionsTrusted: false",
  'botKey: ""',
  'allowedActionTypes: ["none"]',
]);
const chatConfig = segment(
  sources.config,
  "export async function buildSafeChatConfig",
  "export function withBotConfigOverride",
);
forbidTokens("Public chat cache construction", chatConfig, [
  "fetchBoundedPublicText(",
  "await fetch(",
]);
const refresh = segment(
  sources.config,
  "export async function refreshBotKnowledge",
  "export const botConfigBoundaryPosture",
);
requireTokens("Authenticated cache refresh", refresh, [
  "fetchBoundedPublicText(",
  "knowledgeCacheKey(url)",
  "JSON.stringify(record)",
  "expirationTtl: ttl",
]);
forbidTokens("Bot configuration boundary", sources.config, [
  "webhookUrl:",
  "webhookAuthHeader:",
  "webhookSecret:",
  'item === "webhook"',
]);

requireTokens("Hardened router", sources.hardened, [
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
forbidTokens("Hardened router", sources.hardened, [
  'request.headers.get("x-admin-token")',
  "request.json()",
  "response.text()",
  "postPublicWebhook",
  "fetchBoundedPublicText",
]);
const chatRoute = segment(sources.hardened, "async function handleChat", "export default");
forbidTokens("Public chat route", chatRoute, ["await fetch(", "fetchBoundedPublicText("]);
requireOrder("Public chat authorization", chatRoute, [
  "safeStoredNetworkConfig(config)",
  "browserOriginDecision(request, network.origins)",
  "boundedSecretEqual(",
  "buildSafeChatConfig",
  "legacyWorker.fetch",
]);
requireTokens("Legacy isolation", sources.legacy, [
  "export default",
  "async function handleChat",
]);

requireTokens("Admin console", sources.admin, [
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
forbidTokens("Admin console", sources.admin, [
  "x-admin-token",
  "localStorage",
  "sessionStorage",
  'value="hard"',
  "webhookUrl",
  "webhookSecret",
  "brandHex",
]);

requireTokens("Embeddable widget", sources.widget, [
  'script.getAttribute("data-api-base")',
  'script.getAttribute("data-bot-id")',
  'attachShadow({ mode: "open" })',
  "input.maxLength = 2000",
  "readJsonBounded",
  "maximumBytes = 65536",
  'credentials: "omit"',
  'referrerPolicy: "no-referrer"',
  'mode: "cors"',
  'setTimeout(() => controller.abort("timeout"), 20000)',
  'event.key === "Escape"',
  'event.key !== "Tab"',
  "shadow.activeElement",
  "Do not share passwords, access credentials or confidential records.",
  "safeContactUrl",
  "registry.has(botId)",
]);
forbidTokens("Embeddable widget", sources.widget, [
  "innerHTML",
  "insertAdjacentHTML",
  "localStorage",
  "sessionStorage",
  "data-bot-key",
  "Authorization",
]);

requireTokens("Tracked-source secret safety", sources.sourceSecrets, [
  "client-chat-platform-tracked-source-secret-safety-v1",
  'spawnSync("git", ["ls-files", "-z"]',
  "ALLOWED_ENV_FILES",
  "private-key-material",
  "credential-bearing-url",
  "ADMIN_TOKEN=replace_me_with_a_random_server_only_token",
  "rawSecretValuesPrinted: false",
]);
requireTokens("Secret ignore posture", sources.gitignore, [
  ".env.*",
  "!.env.example",
  ".dev.vars.*",
  "!.dev.vars.example",
  ".wrangler/",
  "*.pem",
  "*.key",
]);
requireTokens("Safe local variable template", sources.variables, [
  "ADMIN_TOKEN=replace_me_with_a_random_server_only_token",
  "ADMIN_ALLOWED_ORIGINS=http://localhost:4173",
  "Never commit .dev.vars",
]);

requireTokens("Read-only CI workflow", sources.workflow, [
  "branches: [main]",
  '      - "worker/**"',
  '      - "admin/**"',
  '      - "widget/**"',
  '      - "docs/**"',
  '      - ".dev.vars.example"',
  "permissions:\n  contents: read",
  "cancel-in-progress: true",
  "timeout-minutes: 12",
  "persist-credentials: false",
  'node-version: "24"',
  "cache-dependency-path: worker/package-lock.json",
  "npm ci --no-audit --no-fund",
  "npm run check:source-secrets",
  "npm run check:security",
  "npm run typecheck",
]);
requireOrder("Read-only CI workflow", sources.workflow, [
  "npm ci --no-audit --no-fund",
  "npm run check:source-secrets",
  "npm run check:security",
  "npm run typecheck",
]);
forbidTokens("Read-only CI workflow", sources.workflow, [
  "wrangler deploy",
  "secrets.",
  "ADMIN_TOKEN:",
  "persist-credentials: true",
]);

requireTokens("README operating posture", sources.readme, [
  "The deployed entrypoint is `worker/src/runtime.ts`",
  "removes the retired `x-admin-token` header",
  "@cf/meta/llama-3.2-3b-instruct",
  "Public chat never fetches knowledge URLs live",
  "Workers KV. KV is eventually consistent",
  "npm run check:source-secrets",
  "npm run check:security",
  "npm run typecheck",
  "cmd /c \"npm run deploy\"",
]);
requireTokens("Deployment runbook", sources.deploy, [
  "worker/src/runtime.ts",
  "Do not point Wrangler directly at either compatibility module",
  "cmd /c \"npm ci --no-audit --no-fund\"",
  "cmd /c \"npm run check\"",
  "x-admin-token",
  "X-EVAVO-Chat-Runtime: client_chat_active_runtime_v1",
  "@cf/meta/llama-3.2-3b-instruct",
  "Public chat never fetches source pages during a visitor request",
  "cmd /c \"npm run deploy\"",
  "Direct Wrangler invocation bypasses the npm `predeploy` gate",
  "Workers KV counters and indexes are eventually consistent",
]);
requireTokens("Security boundary document", sources.boundary, [
  "worker/src/runtime.ts",
  "removes the retired administrator header globally",
  "X-EVAVO-Chat-Runtime: client_chat_active_runtime_v1",
  "Public chat performs no external network fetch",
  "kb:v2:<64-character SHA-256 hex digest>",
  "The resulting key is 70 bytes",
  "External webhook execution is disabled",
  "Workers KV is eventually consistent",
]);

const expectedWorkerScripts = {
  "check:source-secrets": "node scripts/check-source-secrets.mjs",
  "check:security": "node scripts/check-security-contract.mjs",
  typecheck: "tsc -p tsconfig.json --noEmit",
  check: "npm run check:source-secrets && npm run check:security && npm run typecheck",
  predeploy: "npm run check",
  deploy: "wrangler deploy -c wrangler.jsonc",
  tail: "wrangler tail -c wrangler.jsonc",
  whoami: "wrangler whoami",
};
for (const [name, command] of Object.entries(expectedWorkerScripts)) {
  if (workerPackage.scripts?.[name] !== command) {
    errors.push(`worker/package.json script ${name} must equal: ${command}`);
  }
}
if (rootPackage.scripts?.check !== "npm --prefix worker run check") {
  errors.push("root package.json must expose check through the Worker package");
}
if (rootPackage.scripts?.deploy !== "npm --prefix worker run deploy") {
  errors.push("root package.json must expose guarded Worker deployment");
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
  contract: "client-chat-platform-security-contract-v4-final-runtime",
  activeEntrypoint: "worker/src/runtime.ts",
  hardenedRouterRequired: true,
  legacyEntrypointActive: false,
  legacyAdminHeaderAllowed: false,
  reviewedModelFallbackRequired: true,
  trackedSourceSecretSafetyRequired: true,
  readOnlyCiRequired: true,
  operatingDocumentationRequired: true,
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
