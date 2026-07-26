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

const sources = {
  runtime: read(workerRoot, "src/runtime.ts"),
  leadCapture: read(workerRoot, "src/leadCapture.ts"),
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
try {
  workerPackage = JSON.parse(sources.package);
} catch {
  errors.push("worker/package.json must remain valid JSON");
}
try {
  workerLock = JSON.parse(sources.lock);
} catch {
  errors.push("worker/package-lock.json must remain valid JSON");
}
try {
  rootPackage = JSON.parse(sources.rootPackage);
} catch {
  errors.push("package.json must remain valid JSON");
}

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

requireTokens("Active runtime", sources.runtime, [
  '"client_chat_active_runtime_v2"',
  'DEFAULT_CHAT_MODEL = "@cf/meta/llama-3.2-3b-instruct"',
  '"@cf/meta/llama-3-8b-instruct"',
  "MODEL_TIMEOUT_MS = 20_000",
  'LEGACY_ADMIN_HEADER = "x-admin-token"',
  'LEAD_ROUTE = "/api/leads"',
  "withoutLegacyAdminHeader",
  "headers.delete(LEGACY_ADMIN_HEADER)",
  "withModelBoundary",
  "Promise.race",
  "clearTimeout(timeout)",
  "withoutImplicitLeadAccess",
  'key.startsWith("lead:")',
  "handleExplicitLeadCapture",
  "leadCapturePreflight",
  'headers.set("X-EVAVO-Chat-Runtime", ACTIVE_CHAT_RUNTIME_CONTRACT)',
  "legacyAdminHeaderRemovedBeforeRouting: true",
  "implicitModelLeadStorageAllowed: false",
  "implicitModelLeadIndexReadsAllowed: false",
  "explicitVisitorLeadConsentRequired: true",
  "rawModelConfigurationExposedInRuntimeHeaders: false",
]);
requireOrder("Active runtime request sequence", sources.runtime, [
  "withoutLegacyAdminHeader(request)",
  "new URL(sanitizedRequest.url).pathname",
  "runtimeEnvironment(",
  "hardenedWorker.fetch",
  "stampRuntimeContract(response)",
]);
forbidTokens("Active runtime", sources.runtime, [
  'request.headers.get("x-admin-token")',
  "request.json()",
  "env.AI.run(",
]);

requireTokens("Explicit lead capture", sources.leadCapture, [
  '"client_chat_explicit_lead_capture_v2"',
  "LEAD_REQUEST_MAX_BYTES = 32 * 1024",
  "LEAD_RATE_LIMIT = 3",
  "LEAD_RETENTION_DAYS = 90",
  'LEAD_CONSENT_VERSION = "visitor_follow_up_consent_v2"',
  'TOP_LEVEL_FIELDS = ["botId", "consent", "evidence", "lead"]',
  "MAX_EVIDENCE_MESSAGES = 20",
  "MAX_EVIDENCE_TOTAL_CHARS = 20_000",
  "sanitizeEvidence",
  "textAppearsInEvidence",
  "phoneAppearsInEvidence",
  "value.consent !== true",
  "browserOriginDecision(request, network.origins) !== origin",
  "readBoundedJsonObject(request, LEAD_REQUEST_MAX_BYTES)",
  "sha256Hex(",
  'key = `lead-rate:v1:${bucket}:${fingerprint}`',
  "crypto.getRandomValues(value)",
  "expirationTtl: LEAD_RETENTION_SECONDS",
  "expiresAt",
  "evidenceStoredWithLead: false",
  "modelActionWritesLeadDirectly: false",
  "rawIpStored: false",
  "userAgentStored: false",
  "recordExpiryRequired: true",
  "indexExpiryRequired: true",
  "rawLeadEchoedInResponse: false",
]);
forbidTokens("Explicit lead capture", sources.leadCapture, [
  "request.json()",
  "await fetch(",
  "sendEmail(",
  "webhook",
]);
const storedLead = segment(
  sources.leadCapture,
  "async function storeExplicitLead",
  "export function leadCapturePreflight",
);
forbidTokens("Stored lead record", storedLead, [
  "evidence:",
  "clientAddress(",
  "user-agent",
]);

requireTokens("Request and network boundary", sources.security, [
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
  "dnsRebindingMitigatedByRuntimePublicFetchFlag: true",
  "fullOperationTimeoutRequired: true",
  "dormantWebhookHelperPresent: false",
]);
forbidTokens("Request and network boundary", sources.security, [
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
forbidTokens("Public chat route", chatRoute, [
  "await fetch(",
  "fetchBoundedPublicText(",
]);
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
  "registry.has(registration)",
  "userEvidence",
  "textSupported",
  "emailFromEvidence",
  "messageFromEvidence",
  'fetch(`${base}/api/leads`',
  "consent: true",
  "evidence: proposal.evidence",
  "Share for follow-up",
  "Nothing is saved until you choose Share",
  "retained for up to 90 days",
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
  "npm run check:bundle",
]);
requireOrder("Read-only CI workflow", sources.workflow, [
  "npm ci --no-audit --no-fund",
  "npm run check:source-secrets",
  "npm run check:security",
  "npm run typecheck",
  "npm run check:bundle",
]);
forbidTokens("Read-only CI workflow", sources.workflow, [
  "secrets.",
  "ADMIN_TOKEN:",
  "persist-credentials: true",
]);

const expectedWorkerScripts = {
  "check:source-secrets": "node scripts/check-source-secrets.mjs",
  "check:security": "node scripts/check-security-contract.mjs",
  typecheck: "tsc -p tsconfig.json --noEmit",
  "check:bundle": "wrangler deploy --dry-run --outdir .wrangler/dry-run -c wrangler.jsonc",
  check: "npm run check:source-secrets && npm run check:security && npm run typecheck && npm run check:bundle",
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
  errors.push("package.json must expose the complete Worker check");
}
if (rootPackage.scripts?.deploy !== "npm --prefix worker run deploy") {
  errors.push("package.json must expose guarded Worker deployment");
}
if (
  workerLock.name !== workerPackage.name ||
  workerLock.packages?.[""]?.name !== workerPackage.name
) {
  errors.push("Worker package and lockfile root identities must remain aligned");
}

for (const [label, source, tokens] of [
  ["README", sources.readme, [
    "worker/src/runtime.ts",
    "client_chat_active_runtime_v2",
    "visitor",
    "90 days",
    "npm run check:bundle",
  ]],
  ["Deployment runbook", sources.deploy, [
    "worker/src/runtime.ts",
    "client_chat_active_runtime_v2",
    "visitor",
    "90 days",
    "npm run check:bundle",
  ]],
  ["Security boundary", sources.boundary, [
    "worker/src/runtime.ts",
    "client_chat_active_runtime_v2",
    "visitor",
    "90 days",
    "explicit",
  ]],
]) {
  requireTokens(label, source, tokens);
}

const fixtureUrl = "https://example.com/";
const cacheKey = `kb:v2:${createHash("sha256").update(fixtureUrl).digest("hex")}`;
if (Buffer.byteLength(cacheKey, "utf8") !== 70) {
  errors.push("Hashed knowledge cache key fixture must remain exactly 70 bytes");
}

console.log(JSON.stringify({
  passed: errors.length === 0,
  repository: "EVAVO-STUDIO/client-chat-platform",
  contract: "client-chat-platform-security-contract-v5-consent-retention-bundle",
  activeEntrypoint: "worker/src/runtime.ts",
  activeRuntimeContract: "client_chat_active_runtime_v2",
  legacyEntrypointActive: false,
  legacyAdminHeaderAllowed: false,
  reviewedModelFallbackRequired: true,
  modelTimeoutRequired: true,
  implicitModelLeadStorageAllowed: false,
  explicitVisitorLeadConsentRequired: true,
  visitorEvidenceRequired: true,
  leadEvidenceStored: false,
  leadRetentionDays: 90,
  trackedSourceSecretSafetyRequired: true,
  readOnlyCiRequired: true,
  dryRunBundleRequired: true,
  publicChatNetworkFetchAllowed: false,
  adminRefreshNetworkOnly: true,
  knowledgeCacheKeyBytes: Buffer.byteLength(cacheKey, "utf8"),
  exactBrowserOriginsRequired: true,
  wildcardOriginsAllowed: false,
  publicBotKeyEmbeddingAllowed: false,
  rawProviderOutputAllowed: false,
  externalWebhookExecutionAllowed: false,
  errors,
}, null, 2));

if (errors.length) process.exitCode = 1;
