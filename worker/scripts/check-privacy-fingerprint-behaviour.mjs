#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(workerRoot, "src", "privacyFingerprint.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
  reportDiagnostics: true,
});
const diagnostics = compiled.diagnostics || [];
if (diagnostics.some((item) => item.category === ts.DiagnosticCategory.Error)) {
  throw new Error("PRIVACY_FINGERPRINT_TRANSPILE_FAILED");
}
const boundary = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText, "utf8").toString("base64")}`
);

const dedicatedSecret = "dedicated-privacy-secret-0123456789abcdef";
const adminFallback = "admin-fallback-secret-0123456789abcdef";
const rawAddress = "203.0.113.10";

const dedicated = await boundary.privacyFingerprint(
  {
    PRIVACY_HASH_SECRET: dedicatedSecret,
    ADMIN_TOKEN: adminFallback,
  },
  "legacy-chat-rate-limit",
  rawAddress,
);
assert.equal(dedicated.ok, true);
assert.equal(dedicated.source, "privacy_hash_secret");
assert.match(dedicated.digest, /^[0-9a-f]{64}$/);
assert.equal(dedicated.digest.includes(rawAddress), false);

const same = await boundary.privacyFingerprint(
  { PRIVACY_HASH_SECRET: dedicatedSecret },
  "legacy-chat-rate-limit",
  rawAddress,
);
assert.equal(same.ok, true);
assert.equal(same.digest, dedicated.digest);

const differentDomain = await boundary.privacyFingerprint(
  { PRIVACY_HASH_SECRET: dedicatedSecret },
  "explicit-lead-rate-limit",
  rawAddress,
);
assert.equal(differentDomain.ok, true);
assert.notEqual(differentDomain.digest, dedicated.digest);

const differentSecret = await boundary.privacyFingerprint(
  { PRIVACY_HASH_SECRET: "second-dedicated-privacy-secret-0123456789" },
  "legacy-chat-rate-limit",
  rawAddress,
);
assert.equal(differentSecret.ok, true);
assert.notEqual(differentSecret.digest, dedicated.digest);

const fallback = await boundary.privacyFingerprint(
  { ADMIN_TOKEN: adminFallback },
  "legacy-chat-rate-limit",
  rawAddress,
);
assert.equal(fallback.ok, true);
assert.equal(fallback.source, "admin_token_fallback");
assert.notEqual(fallback.digest, dedicated.digest);

const weakDedicatedFallsBack = await boundary.privacyFingerprint(
  {
    PRIVACY_HASH_SECRET: "too-short",
    ADMIN_TOKEN: adminFallback,
  },
  "legacy-chat-rate-limit",
  rawAddress,
);
assert.equal(weakDedicatedFallsBack.ok, true);
assert.equal(weakDedicatedFallsBack.source, "admin_token_fallback");

const unavailable = await boundary.privacyFingerprint(
  {
    PRIVACY_HASH_SECRET: "too-short",
    ADMIN_TOKEN: "also-short",
  },
  "legacy-chat-rate-limit",
  rawAddress,
);
assert.deepEqual(unavailable, {
  ok: false,
  error: "privacy_hash_not_configured",
  contract: "client_chat_privacy_fingerprint_v1",
});

console.log(JSON.stringify({
  passed: true,
  repository: "EVAVO-STUDIO/client-chat-platform",
  contract: "client-chat-privacy-fingerprint-behaviour-v1",
  algorithm: "HMAC-SHA-256",
  dedicatedSecretPreferred: true,
  boundedAdminTokenFallbackVerified: true,
  domainSeparationVerified: true,
  deterministicForSameDomainAndInput: true,
  unkeyedClientAddressDigestAllowed: false,
  missingValidSecretFailsClosed: true,
  rawClientAddressStored: false,
}, null, 2));
