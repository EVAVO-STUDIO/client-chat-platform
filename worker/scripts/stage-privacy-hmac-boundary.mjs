#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const workerRoot = process.cwd();
const repositoryRoot = path.resolve(workerRoot, "..");
const workflowPath = path.join(repositoryRoot, ".github/workflows/stage-privacy-hmac-boundary.yml");
const scriptPath = path.join(workerRoot, "scripts/stage-privacy-hmac-boundary.mjs");

function read(relativePath, root = workerRoot) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function write(relativePath, value, root = workerRoot) {
  fs.writeFileSync(path.join(root, relativePath), value, "utf8");
}

function replaceRequired(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing expected ${label}`);
  return source.replace(from, to);
}

let legacy = read("src/index.ts");
legacy = replaceRequired(
  legacy,
  '  ADMIN_TOKEN?: string; // set via `wrangler secret put ADMIN_TOKEN`\n',
  '  ADMIN_TOKEN?: string; // set via `wrangler secret put ADMIN_TOKEN`\n  PRIVACY_HASH_SECRET?: string; // preferred HMAC key for pseudonymous rate-limit identifiers\n',
  "legacy environment privacy secret",
);
write("src/index.ts", legacy);

let storage = read("src/runtimeStorageBoundary.ts");
storage = replaceRequired(
  storage,
  'import { sha256Hex } from "./security";',
  'import {\n  privacyFingerprint,\n  type PrivacySecretEnvironment,\n} from "./privacyFingerprint";',
  "runtime storage privacy import",
);
storage = replaceRequired(
  storage,
  '  "client_chat_runtime_storage_boundary_v4" as const;',
  '  "client_chat_runtime_storage_boundary_v5_keyed_privacy" as const;',
  "runtime storage contract",
);
storage = replaceRequired(
  storage,
  'const HASHED_RATE_LIMIT_PREFIX = "rl:v2:";',
  'const HASHED_RATE_LIMIT_PREFIX = "rl:v3:";\nconst LEGACY_HASHED_RATE_LIMIT_PREFIX = "rl:v2:";',
  "rate limit key prefixes",
);
storage = replaceRequired(
  storage,
  `async function privacySafeRateLimitKey(key: string) {
  if (key.startsWith(HASHED_RATE_LIMIT_PREFIX)) return key;
  if (!key.startsWith(LEGACY_RATE_LIMIT_PREFIX)) return key;
  return \`${'${HASHED_RATE_LIMIT_PREFIX}${await sha256Hex('}
    \`client-chat-rate-limit\\u0000\${key}\`,
  )}\`;
}

export function withHashedLegacyRateLimitKeys(binding: KVNamespace) {`,
  `async function privacySafeRateLimitKey(
  key: string,
  env: PrivacySecretEnvironment,
) {
  if (
    key.startsWith(HASHED_RATE_LIMIT_PREFIX) ||
    key.startsWith(LEGACY_HASHED_RATE_LIMIT_PREFIX)
  ) {
    return key;
  }
  if (!key.startsWith(LEGACY_RATE_LIMIT_PREFIX)) return key;
  const fingerprint = await privacyFingerprint(
    env,
    "legacy-chat-rate-limit",
    key,
  );
  if (!fingerprint.ok) throw new Error(fingerprint.error);
  return \`${'${HASHED_RATE_LIMIT_PREFIX}${fingerprint.digest}'}\`;
}

export function withHashedLegacyRateLimitKeys(
  binding: KVNamespace,
  env: PrivacySecretEnvironment,
) {`,
  "keyed rate limit function",
);
storage = storage.replaceAll(
  'await privacySafeRateLimitKey(String(key))',
  'await privacySafeRateLimitKey(String(key), env)',
);
storage = replaceRequired(
  storage,
  '  rawClientAddressStoredInLegacyRateLimitKey: false,\n  alreadyHashedRateLimitKeysRehashed: false,\n  hashedLegacyRateLimitKeyPrefix: HASHED_RATE_LIMIT_PREFIX,\n  rateLimitIdentifierPseudonymousNotAnonymous: true,\n',
  '  rawClientAddressStoredInLegacyRateLimitKey: false,\n  unkeyedClientAddressDigestAllowed: false,\n  keyedHmacRateLimitIdentifiersRequired: true,\n  dedicatedPrivacySecretPreferred: true,\n  boundedAdminTokenFallbackAllowed: true,\n  missingPrivacyKeyMaterialFailsClosed: true,\n  alreadyHashedRateLimitKeysRehashed: false,\n  hashedLegacyRateLimitKeyPrefix: HASHED_RATE_LIMIT_PREFIX,\n  historicalUnkeyedPrefixRecognized: LEGACY_HASHED_RATE_LIMIT_PREFIX,\n  rateLimitIdentifierPseudonymousNotAnonymous: true,\n',
  "runtime storage privacy posture",
);
write("src/runtimeStorageBoundary.ts", storage);

let runtime = read("src/runtime.ts");
runtime = replaceRequired(
  runtime,
  '      ? withHashedLegacyRateLimitKeys(env.KB_CACHE)\n',
  '      ? withHashedLegacyRateLimitKeys(env.KB_CACHE, env)\n',
  "runtime keyed rate limit wiring",
);
runtime = replaceRequired(
  runtime,
  '  rawClientAddressStoredInLegacyRateLimitKey: false,\n',
  '  rawClientAddressStoredInLegacyRateLimitKey: false,\n  unkeyedClientAddressDigestAllowed: false,\n  keyedRateLimitFingerprintsRequired: true,\n  privacyHashSecretPreferredWithAdminFallback: true,\n',
  "runtime keyed privacy posture",
);
write("src/runtime.ts", runtime);

let lead = read("src/leadCapture.ts");
lead = replaceRequired(
  lead,
  `import {
  normalizeAllowedOrigin,
  readBoundedJsonObject,
  sha256Hex,
} from "./security";`,
  `import { privacyFingerprint } from "./privacyFingerprint";
import {
  normalizeAllowedOrigin,
  readBoundedJsonObject,
} from "./security";`,
  "lead privacy import",
);
lead = replaceRequired(
  lead,
  'export type LeadCaptureEnv = Pick<LegacyEnv, "BOT_CONFIG" | "KB_CACHE">;',
  'export type LeadCaptureEnv = Pick<\n  LegacyEnv,\n  "BOT_CONFIG" | "KB_CACHE" | "ADMIN_TOKEN" | "PRIVACY_HASH_SECRET"\n>;',
  "lead environment privacy secret",
);
lead = replaceRequired(
  lead,
  `  const fingerprint = await sha256Hex(
    \`client-chat-lead-rate\\u0000\${botId}\\u0000\${origin}\\u0000\${clientAddress(request)}\`,
  );
  const key = \`lead-rate:v1:\${bucket}:\${fingerprint}\`;`,
  `  const fingerprint = await privacyFingerprint(
    env,
    "explicit-lead-rate-limit",
    \`\${botId}\\u0000\${origin}\\u0000\${clientAddress(request)}\`,
  );
  if (!fingerprint.ok) return null;
  const key = \`lead-rate:v2:\${bucket}:\${fingerprint.digest}\`;`,
  "lead keyed rate limit",
);
lead = replaceRequired(
  lead,
  '  rawIpStored: false,\n  userAgentStored: false,\n',
  '  rawIpStored: false,\n  unkeyedIpDigestStored: false,\n  keyedHmacRateLimitFingerprintRequired: true,\n  missingPrivacyKeyMaterialFailsClosed: true,\n  userAgentStored: false,\n',
  "lead privacy posture",
);
write("src/leadCapture.ts", lead);

let behavior = read("scripts/check-runtime-storage-behaviour.mjs");
behavior = replaceRequired(
  behavior,
  `const instrumented = source.replace(
  'import { sha256Hex } from "./security";',
  \`async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("");
  }\`,
);`,
  `const instrumented = source.replace(
  'import {\\n  privacyFingerprint,\\n  type PrivacySecretEnvironment,\\n} from "./privacyFingerprint";',
  \`async function privacyFingerprint(env, domain, value) {
    const secret = env.PRIVACY_HASH_SECRET || env.ADMIN_TOKEN;
    if (typeof secret !== "string" || new TextEncoder().encode(secret).byteLength < 32) {
      return { ok: false, error: "privacy_hash_not_configured", contract: "client_chat_privacy_fingerprint_v1" };
    }
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(\\\`client_chat_privacy_fingerprint_v1\\u0000\\${domain}\\u0000\\${value}\\\`));
    const digest = Array.from(new Uint8Array(signed), (item) => item.toString(16).padStart(2, "0")).join("");
    return { ok: true, digest, source: env.PRIVACY_HASH_SECRET ? "privacy_hash_secret" : "admin_token_fallback", contract: "client_chat_privacy_fingerprint_v1" };
  }\`,
);`,
  "behavior privacy import instrumentation",
);
behavior = replaceRequired(
  behavior,
  '  throw new Error("RUNTIME_STORAGE_SECURITY_IMPORT_NOT_FOUND");',
  '  throw new Error("RUNTIME_STORAGE_PRIVACY_IMPORT_NOT_FOUND");',
  "behavior import failure",
);
behavior = replaceRequired(
  behavior,
  `{
  const kv = new FakeKV([["rl:v2:already-hashed", "7"]]);
  const protectedKv = boundary.withHashedLegacyRateLimitKeys(kv);
  await protectedKv.put("rl:evavo:203.0.113.10:123", "1", { expirationTtl: 70 });
  const hashedPut = kv.operations.find(
    (item) => item.operation === "put" && item.value === "1",
  );
  assert.match(hashedPut.key, /^rl:v2:[0-9a-f]{64}$/);
  assert.equal(hashedPut.key.includes("203.0.113.10"), false);

  await protectedKv.get("rl:v2:already-hashed");
  const finalGet = kv.operations.at(-1);
  assert.equal(finalGet.key, "rl:v2:already-hashed");
}`,
  `{
  const kv = new FakeKV([["rl:v2:historical-hash", "7"]]);
  const protectedKv = boundary.withHashedLegacyRateLimitKeys(kv, {
    PRIVACY_HASH_SECRET: "dedicated-privacy-secret-0123456789abcdef",
  });
  await protectedKv.put("rl:evavo:203.0.113.10:123", "1", { expirationTtl: 70 });
  const hashedPut = kv.operations.find(
    (item) => item.operation === "put" && item.value === "1",
  );
  assert.match(hashedPut.key, /^rl:v3:[0-9a-f]{64}$/);
  assert.equal(hashedPut.key.includes("203.0.113.10"), false);

  await protectedKv.get("rl:v2:historical-hash");
  const historicalGet = kv.operations.at(-1);
  assert.equal(historicalGet.key, "rl:v2:historical-hash");

  const unavailable = boundary.withHashedLegacyRateLimitKeys(new FakeKV(), {});
  await assert.rejects(
    unavailable.get("rl:evavo:203.0.113.10:123"),
    /privacy_hash_not_configured/,
  );
}`,
  "behavior keyed rate limit test",
);
behavior = replaceRequired(
  behavior,
  '  contract: "client-chat-runtime-storage-behaviour-v1",',
  '  contract: "client-chat-runtime-storage-behaviour-v2-keyed-privacy",',
  "behavior contract version",
);
behavior = replaceRequired(
  behavior,
  '  rawClientAddressUsedAsKvKey: false,\n  alreadyHashedRateLimitKeyRehashed: false,\n',
  '  rawClientAddressUsedAsKvKey: false,\n  unkeyedClientAddressDigestAllowed: false,\n  keyedHmacRateLimitVerified: true,\n  missingPrivacyKeyMaterialFailsClosed: true,\n  historicalV2RateLimitKeyRehashed: false,\n',
  "behavior privacy report",
);
write("scripts/check-runtime-storage-behaviour.mjs", behavior);

let packageJson = JSON.parse(read("package.json"));
packageJson.scripts["check:privacy-fingerprint"] =
  "node scripts/check-privacy-fingerprint-behaviour.mjs";
packageJson.scripts.check =
  "npm run check:source-secrets && npm run check:privacy-fingerprint && npm run check:security && npm run typecheck && npm run check:bundle";
write("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);

let workflow = read(".github/workflows/worker-security.yml", repositoryRoot);
workflow = replaceRequired(
  workflow,
  '      - name: Verify hardened architecture contract\n        run: npm run check:security\n',
  '      - name: Verify keyed privacy fingerprint behavior\n        run: npm run check:privacy-fingerprint\n\n      - name: Verify hardened architecture contract\n        run: npm run check:security\n',
  "workflow privacy step",
);
write(".github/workflows/worker-security.yml", workflow, repositoryRoot);

let variables = read(".dev.vars.example", repositoryRoot);
variables = replaceRequired(
  variables,
  'ADMIN_TOKEN=replace_me_with_a_random_server_only_token\n\n',
  'ADMIN_TOKEN=replace_me_with_a_random_server_only_token\n\n# Preferred independent HMAC key for pseudonymous rate-limit identifiers.\n# Use a different random 32-256 byte value without whitespace.\n# When omitted, the bounded ADMIN_TOKEN is used only as a domain-separated compatibility fallback.\nPRIVACY_HASH_SECRET=replace_me_with_a_different_random_privacy_hash_secret\n\n',
  "privacy secret template",
);
write(".dev.vars.example", variables, repositoryRoot);

let adminCheck = read("scripts/check-admin-config-secret-boundary.mjs");
adminCheck = replaceRequired(
  adminCheck,
  '  "client_chat_runtime_storage_boundary_v4",',
  '  "client_chat_runtime_storage_boundary_v5_keyed_privacy",',
  "admin storage contract",
);
adminCheck = replaceRequired(
  adminCheck,
  '  \'HASHED_RATE_LIMIT_PREFIX = "rl:v2:"\',\n',
  '  \'HASHED_RATE_LIMIT_PREFIX = "rl:v3:"\',\n  \'LEGACY_HASHED_RATE_LIMIT_PREFIX = "rl:v2:"\',\n',
  "admin rate limit prefixes",
);
adminCheck = replaceRequired(
  adminCheck,
  '  "key.startsWith(HASHED_RATE_LIMIT_PREFIX)",\n  "sha256Hex(",\n',
  '  "key.startsWith(HASHED_RATE_LIMIT_PREFIX)",\n  "privacyFingerprint(",\n  \'"legacy-chat-rate-limit"\',\n  "unkeyedClientAddressDigestAllowed: false",\n  "keyedHmacRateLimitIdentifiersRequired: true",\n  "missingPrivacyKeyMaterialFailsClosed: true",\n',
  "admin keyed privacy posture",
);
adminCheck = replaceRequired(
  adminCheck,
  '  "withHashedLegacyRateLimitKeys(env.KB_CACHE)",',
  '  "withHashedLegacyRateLimitKeys(env.KB_CACHE, env)",',
  "admin keyed runtime wiring",
);
adminCheck = replaceRequired(
  adminCheck,
  '  \'contract: "client-chat-runtime-storage-behaviour-v1"\',',
  '  \'contract: "client-chat-runtime-storage-behaviour-v2-keyed-privacy"\',',
  "admin behavior contract",
);
adminCheck = replaceRequired(
  adminCheck,
  '  "alreadyHashedRateLimitKeyRehashed: false",\n',
  '  "keyedHmacRateLimitVerified: true",\n  "missingPrivacyKeyMaterialFailsClosed: true",\n  "historicalV2RateLimitKeyRehashed: false",\n',
  "admin behavior privacy report",
);
adminCheck = replaceRequired(
  adminCheck,
  '  "check:config-secrets:source": "node scripts/check-admin-config-secret-boundary.mjs",\n',
  '  "check:privacy-fingerprint": "node scripts/check-privacy-fingerprint-behaviour.mjs",\n  "check:config-secrets:source": "node scripts/check-admin-config-secret-boundary.mjs",\n',
  "admin privacy script",
);
adminCheck = replaceRequired(
  adminCheck,
  '  "npm run check:security",\n',
  '  "npm run check:privacy-fingerprint",\n  "npm run check:security",\n',
  "admin workflow privacy token",
);
adminCheck = replaceRequired(
  adminCheck,
  '  "rl:v2:<sha256>",\n  "pseudonymous rather than anonymous",\n',
  '  "rl:v3:<hmac-sha256>",\n  "PRIVACY_HASH_SECRET",\n  "domain-separated",\n  "pseudonymous rather than anonymous",\n',
  "admin documentation privacy tokens",
);
adminCheck = replaceRequired(
  adminCheck,
  '  "rl:v2:<sha256>",\n  "npm run check:config-secrets",\n',
  '  "rl:v3:<hmac-sha256>",\n  "PRIVACY_HASH_SECRET",\n  "npm run check:config-secrets",\n',
  "README privacy tokens",
);
adminCheck = replaceRequired(
  adminCheck,
  '  contract: "client-chat-admin-config-secret-safety-v6-behavioral",',
  '  contract: "client-chat-admin-config-secret-safety-v7-keyed-privacy",',
  "admin contract version",
);
adminCheck = replaceRequired(
  adminCheck,
  '  rateLimitIdentifiersPseudonymous: true,\n',
  '  rateLimitIdentifiersPseudonymous: true,\n  unkeyedRateLimitFingerprintsAllowed: false,\n  keyedHmacRateLimitFingerprintsRequired: true,\n  dedicatedPrivacySecretPreferred: true,\n',
  "admin privacy report",
);
write("scripts/check-admin-config-secret-boundary.mjs", adminCheck);

let securityCheck = read("scripts/check-security-contract.mjs");
securityCheck = replaceRequired(
  securityCheck,
  '  security: read(workerRoot, "src/security.ts"),\n',
  '  security: read(workerRoot, "src/security.ts"),\n  privacy: read(workerRoot, "src/privacyFingerprint.ts"),\n  privacyBehavior: read(workerRoot, "scripts/check-privacy-fingerprint-behaviour.mjs"),\n',
  "security privacy sources",
);
securityCheck = replaceRequired(
  securityCheck,
  '  "rawModelConfigurationExposedInRuntimeHeaders: false",\n',
  '  "rawModelConfigurationExposedInRuntimeHeaders: false",\n  "withHashedLegacyRateLimitKeys(env.KB_CACHE, env)",\n  "unkeyedClientAddressDigestAllowed: false",\n  "keyedRateLimitFingerprintsRequired: true",\n',
  "security runtime privacy tokens",
);
securityCheck = replaceRequired(
  securityCheck,
  '  "sha256Hex(",\n  \'key = `lead-rate:v1:${bucket}:${fingerprint}`\',\n',
  '  "privacyFingerprint(",\n  \'"explicit-lead-rate-limit"\',\n  \'key = `lead-rate:v2:${bucket}:${fingerprint.digest}`\',\n  "unkeyedIpDigestStored: false",\n  "keyedHmacRateLimitFingerprintRequired: true",\n',
  "security lead privacy tokens",
);
securityCheck = replaceRequired(
  securityCheck,
  'forbidTokens("Explicit lead capture", sources.leadCapture, [\n',
  'requireTokens("Keyed privacy fingerprint boundary", sources.privacy, [\n  \'"client_chat_privacy_fingerprint_v1"\',\n  \'algorithm: "HMAC-SHA-256"\',\n  "PRIVACY_HASH_SECRET_MIN_BYTES = 32",\n  "PRIVACY_HASH_SECRET_MAX_BYTES = 256",\n  "resolvePrivacyHashSecret",\n  \'source: "privacy_hash_secret"\',\n  \'source: "admin_token_fallback"\',\n  \'{ name: "HMAC", hash: "SHA-256" }\',\n  "crypto.subtle.sign",\n  "domainSeparationRequired: true",\n  "missingSecretFailsClosed: true",\n  "unkeyedClientAddressDigestAllowed: false",\n]);\nrequireTokens("Keyed privacy fingerprint behavior", sources.privacyBehavior, [\n  \'contract: "client-chat-privacy-fingerprint-behaviour-v1"\',\n  "dedicatedSecretPreferred: true",\n  "boundedAdminTokenFallbackVerified: true",\n  "domainSeparationVerified: true",\n  "missingValidSecretFailsClosed: true",\n]);\nforbidTokens("Explicit lead capture", sources.leadCapture, [\n',
  "security privacy boundary",
);
securityCheck = replaceRequired(
  securityCheck,
  '  "ADMIN_TOKEN=replace_me_with_a_random_server_only_token",\n  "ADMIN_ALLOWED_ORIGINS=http://localhost:4173",\n',
  '  "ADMIN_TOKEN=replace_me_with_a_random_server_only_token",\n  "PRIVACY_HASH_SECRET=replace_me_with_a_different_random_privacy_hash_secret",\n  "ADMIN_ALLOWED_ORIGINS=http://localhost:4173",\n',
  "security variable template",
);
securityCheck = replaceRequired(
  securityCheck,
  '  "npm run check:source-secrets",\n  "npm run check:security",\n',
  '  "npm run check:source-secrets",\n  "npm run check:privacy-fingerprint",\n  "npm run check:security",\n',
  "security workflow privacy token",
);
securityCheck = replaceRequired(
  securityCheck,
  '  "npm run check:source-secrets",\n  "npm run check:security",\n  "npm run typecheck",\n',
  '  "npm run check:source-secrets",\n  "npm run check:privacy-fingerprint",\n  "npm run check:security",\n  "npm run typecheck",\n',
  "security workflow privacy order",
);
securityCheck = replaceRequired(
  securityCheck,
  '  "check:source-secrets": "node scripts/check-source-secrets.mjs",\n',
  '  "check:source-secrets": "node scripts/check-source-secrets.mjs",\n  "check:privacy-fingerprint": "node scripts/check-privacy-fingerprint-behaviour.mjs",\n',
  "security privacy script",
);
securityCheck = replaceRequired(
  securityCheck,
  '  check: "npm run check:source-secrets && npm run check:security && npm run typecheck && npm run check:bundle",',
  '  check: "npm run check:source-secrets && npm run check:privacy-fingerprint && npm run check:security && npm run typecheck && npm run check:bundle",',
  "security complete check",
);
securityCheck = replaceRequired(
  securityCheck,
  '    "npm run check:bundle",\n',
  '    "npm run check:bundle",\n    "PRIVACY_HASH_SECRET",\n    "HMAC-SHA-256",\n',
  "security documentation privacy tokens",
);
securityCheck = replaceRequired(
  securityCheck,
  '  contract: "client-chat-platform-security-contract-v5-consent-retention-bundle",',
  '  contract: "client-chat-platform-security-contract-v6-keyed-privacy",',
  "security contract version",
);
securityCheck = replaceRequired(
  securityCheck,
  '  trackedSourceSecretSafetyRequired: true,\n',
  '  trackedSourceSecretSafetyRequired: true,\n  keyedPrivacyFingerprintRequired: true,\n  dedicatedPrivacySecretPreferred: true,\n  boundedAdminTokenCompatibilityFallbackAllowed: true,\n  unkeyedClientAddressDigestAllowed: false,\n',
  "security privacy report",
);
write("scripts/check-security-contract.mjs", securityCheck);

let adminDoc = read("docs/admin-config-secret-boundary.md", repositoryRoot);
adminDoc = replaceRequired(
  adminDoc,
  "client_chat_runtime_storage_boundary_v4",
  "client_chat_runtime_storage_boundary_v5_keyed_privacy",
  "admin doc contract",
);
adminDoc = replaceRequired(
  adminDoc,
  `rl:v2:<sha256>`,
  `rl:v3:<hmac-sha256>`,
  "admin doc key format",
);
adminDoc = replaceRequired(
  adminDoc,
  "before the key reaches `KB_CACHE`. A key already using the `rl:v2:` form is not hashed again.\n\nThis prevents the raw client address from appearing in KV key names. The hash is pseudonymous rather than anonymous, and the KV limiter remains best-effort because Workers KV does not provide a transactional increment primitive. It must not be described as a globally exact abuse-control counter.",
  "before the key reaches `KB_CACHE`. The HMAC is domain-separated and keyed by `PRIVACY_HASH_SECRET`; a valid bounded `ADMIN_TOKEN` is accepted only as a compatibility fallback when the dedicated secret has not yet been configured. Historical `rl:v2:` values are recognized and not transformed again, while all new raw `rl:` keys use the v3 keyed format.\n\nThis prevents the raw client address from appearing in KV key names and makes offline dictionary recovery impractical without server-only key material. The identifier remains pseudonymous rather than anonymous, and the KV limiter remains best-effort because Workers KV does not provide a transactional increment primitive. Missing valid key material fails closed before a raw-address-derived KV operation. It must not be described as a globally exact abuse-control counter.",
  "admin doc keyed privacy explanation",
);
adminDoc = replaceRequired(
  adminDoc,
  "npm run check:config-secrets\nnpm run check:security",
  "npm run check:privacy-fingerprint\nnpm run check:config-secrets\nnpm run check:security",
  "admin doc privacy command",
);
write("docs/admin-config-secret-boundary.md", adminDoc, repositoryRoot);

let readme = read("README.md", repositoryRoot);
readme = replaceRequired(
  readme,
  "- Legacy chat rate-limit KV keys are replaced by `rl:v2:<sha256>` identifiers so raw client addresses are not embedded in key names.",
  "- Chat and lead rate-limit identifiers use domain-separated HMAC-SHA-256. `PRIVACY_HASH_SECRET` is preferred; a bounded `ADMIN_TOKEN` is a compatibility fallback. New chat keys use `rl:v3:<hmac-sha256>` and raw client addresses are never embedded in KV key names.",
  "README keyed rate limit",
);
readme = replaceRequired(
  readme,
  "- a privacy-preserving best-effort rate bucket.",
  "- a keyed, privacy-preserving best-effort rate bucket.",
  "README lead keyed bucket",
);
readme = replaceRequired(
  readme,
  "The chat rate-limit key is pseudonymous rather than anonymous. Hashing removes the raw client address from the KV key name but does not make the limiter transactional or suitable as a compliance-grade identity system.",
  "Rate-limit identifiers are pseudonymous rather than anonymous. Domain-separated HMAC removes the raw client address from KV key names and prevents practical offline enumeration without the server-only key, but it does not make Workers KV transactional or suitable as a compliance-grade identity system.",
  "README privacy limitation",
);
readme = replaceRequired(
  readme,
  "1. `npm run check:source-secrets`\n2. `npm run check:config-secrets`, automatically invoked by the `precheck:security` lifecycle hook\n3. `npm run check:security`\n4. `npm run typecheck`\n5. `npm run check:bundle`",
  "1. `npm run check:source-secrets`\n2. `npm run check:privacy-fingerprint`\n3. `npm run check:config-secrets`, automatically invoked by the `precheck:security` lifecycle hook\n4. `npm run check:security`\n5. `npm run typecheck`\n6. `npm run check:bundle`",
  "README check order",
);
readme = replaceRequired(
  readme,
  "# Replace the ADMIN_TOKEN placeholder in .dev.vars with a random server-only value.\ncmd /c \"npm run check:source-secrets\"",
  "# Replace ADMIN_TOKEN and PRIVACY_HASH_SECRET with different random server-only values.\ncmd /c \"npm run check:source-secrets\"\ncmd /c \"npm run check:privacy-fingerprint\"",
  "README local privacy validation",
);
write("README.md", readme, repositoryRoot);

let deploy = read("DEPLOY.md", repositoryRoot);
deploy = replaceRequired(
  deploy,
  "- The current Worker administrator token, or authority to rotate it.",
  "- The current Worker administrator token and privacy-hash secret, or authority to rotate them.",
  "deploy prerequisites",
);
deploy = replaceRequired(
  deploy,
  "ADMIN_TOKEN=replace_me_with_a_random_server_only_token\n```",
  "ADMIN_TOKEN=replace_me_with_a_random_server_only_token\nPRIVACY_HASH_SECRET=replace_me_with_a_different_random_privacy_hash_secret\n```",
  "deploy local variables",
);
deploy = replaceRequired(
  deploy,
  "1. `npm run check:source-secrets`\n2. `npm run check:security`\n3. `npm run typecheck`\n4. `npm run check:bundle`",
  "1. `npm run check:source-secrets`\n2. `npm run check:privacy-fingerprint`\n3. `npm run check:security`\n4. `npm run typecheck`\n5. `npm run check:bundle`",
  "deploy check order",
);
deploy = replaceRequired(
  deploy,
  'cmd /c "npx wrangler secret put ADMIN_TOKEN -c wrangler.jsonc"\n```',
  'cmd /c "npx wrangler secret put ADMIN_TOKEN -c wrangler.jsonc"\ncmd /c "npx wrangler secret put PRIVACY_HASH_SECRET -c wrangler.jsonc"\n```',
  "deploy production secrets",
);
deploy = replaceRequired(
  deploy,
  "The evidence is verified but not stored. Raw IP addresses and user-agent strings are not stored. Explicit lead records and their index expire after 90 days.",
  "The evidence is verified but not stored. Raw IP addresses and user-agent strings are not stored. Rate-limit identifiers use domain-separated HMAC-SHA-256 with `PRIVACY_HASH_SECRET`, or the bounded administrator credential only as a compatibility fallback. Explicit lead records and their index expire after 90 days.",
  "deploy lead privacy",
);
write("DEPLOY.md", deploy, repositoryRoot);

let boundary = read("docs/security-boundary.md", repositoryRoot);
boundary = replaceRequired(
  boundary,
  "- `KB_CACHE` KV for verified knowledge-cache records and best-effort counters.",
  "- `KB_CACHE` KV for verified knowledge-cache records and best-effort counters whose client-derived identifiers use a server-keyed HMAC.",
  "security doc binding privacy",
);
boundary = replaceRequired(
  boundary,
  "- a privacy-preserving best-effort rate bucket.",
  "- a domain-separated HMAC best-effort rate bucket.",
  "security doc lead rate",
);
boundary = replaceRequired(
  boundary,
  "Evidence is used only for verification and is not stored with the lead. Raw IP addresses and user-agent strings are not stored. The response contains an ID, timestamps, consent version and retention period but echoes no contact fields.",
  "Evidence is used only for verification and is not stored with the lead. Raw IP addresses and user-agent strings are not stored. Rate-limit identifiers use HMAC-SHA-256 with `PRIVACY_HASH_SECRET`; a valid bounded `ADMIN_TOKEN` is accepted only as a compatibility fallback. Missing valid key material fails closed. The response contains an ID, timestamps, consent version and retention period but echoes no contact fields.",
  "security doc keyed lead privacy",
);
boundary = replaceRequired(
  boundary,
  "## KV consistency limitations",
  "## Rate-limit identifier privacy\n\nNew chat keys use `rl:v3:<hmac-sha256>`, and explicit lead buckets use the equivalent keyed fingerprint contract. The HMAC input is domain-separated so chat and lead identifiers cannot be correlated by digest equality. `PRIVACY_HASH_SECRET` is the preferred independent 32–256 byte secret. A valid bounded `ADMIN_TOKEN` is retained only as a compatibility fallback during rollout. Unkeyed SHA-256 of client addresses is not allowed for new keys. Historical `rl:v2:` keys are left to expire naturally and are not rewritten or treated as new raw identifiers.\n\nThe identifiers remain pseudonymous rather than anonymous. They must not be used as identity, profiling or compliance records.\n\n## KV consistency limitations",
  "security doc rate privacy section",
);
boundary = replaceRequired(
  boundary,
  "1. tracked-source secret safety;\n2. deterministic security architecture contract;\n3. TypeScript validation;",
  "1. tracked-source secret safety;\n2. deterministic keyed-privacy behavior;\n3. deterministic security architecture contract;\n4. TypeScript validation;",
  "security doc gate order",
);
write("docs/security-boundary.md", boundary, repositoryRoot);

for (const temporaryPath of [workflowPath, scriptPath]) {
  if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath);
}

console.log(JSON.stringify({
  staged: true,
  contract: "client_chat_privacy_fingerprint_v1",
  runtimeStorageContract: "client_chat_runtime_storage_boundary_v5_keyed_privacy",
  dedicatedPrivacySecretPreferred: true,
  boundedAdminTokenFallbackAllowed: true,
  unkeyedClientAddressDigestAllowed: false,
  temporaryStagingFilesRemoved: true,
}, null, 2));
