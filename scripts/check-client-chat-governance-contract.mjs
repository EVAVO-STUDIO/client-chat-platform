#!/usr/bin/env node

import fs from "node:fs";

const files = {
  profile: "evavo.reliability.json",
  releaseContract: "scripts/check-client-chat-release-contract.mjs",
  runner: "scripts/run-client-chat-validation.mjs",
  workflow: ".github/workflows/evavo-mainline-confirmation.yml",
  agents: "AGENTS.md",
  claude: "CLAUDE.md",
  copilot: ".github/copilot-instructions.md",
  security: "docs/SECURITY_AND_ORIGINS.md",
  storage: "docs/STORAGE_AND_RETENTION.md",
  evidence: "docs/RELEASE_EVIDENCE.md",
};
const source = Object.fromEntries(
  Object.entries(files).map(([key, file]) => {
    if (!fs.existsSync(file)) {
      throw new Error(`Missing Client Chat governance file: ${file}`);
    }
    return [key, fs.readFileSync(file, "utf8")];
  }),
);
const errors = [];
const requireTokens = (label, text, tokens) => {
  for (const token of tokens) {
    if (!text.includes(token)) errors.push(`${label} is missing ${token}`);
  }
};
const forbidTokens = (label, text, tokens) => {
  for (const token of tokens) {
    if (text.includes(token)) errors.push(`${label} contains forbidden ${token}`);
  }
};

const profile = JSON.parse(source.profile);
if (
  profile.schemaVersion !== "1.0" ||
  profile.repository !== "EVAVO-STUDIO/client-chat-platform" ||
  profile.defaultBranch !== "main" ||
  profile.authority !== "active-commercial-slot" ||
  profile.workload !== "cloudflare-worker"
) {
  errors.push("Client Chat reliability profile identity is invalid.");
}
if (
  profile.packageManager?.name !== "repository-declared" ||
  profile.packageManager?.lockfilePolicy !== "single-authoritative-lockfile"
) {
  errors.push("Client Chat package-management policy is invalid.");
}
if (
  profile.runtime?.node !== ">=22.14.0" ||
  profile.runtime?.provider !== "cloudflare-workers" ||
  profile.runtime?.liveProviderEvidenceRequired !== true
) {
  errors.push("Client Chat runtime policy is invalid.");
}
const expectedValidation = [
  "node ./scripts/check-client-chat-governance-contract.mjs",
  "node ./scripts/check-client-chat-release-contract.mjs",
  "node ./scripts/run-client-chat-validation.mjs --mode source",
];
if (
  !Array.isArray(profile.validation) ||
  profile.validation.length !== expectedValidation.length ||
  expectedValidation.some((command, index) => profile.validation[index] !== command)
) {
  errors.push("Client Chat validation order is invalid.");
}
if (
  profile.branchPolicy?.mode !== "direct-main" ||
  profile.branchPolicy?.exclusiveLeaseRequired !== true ||
  profile.branchPolicy?.forcePushAllowed !== false
) {
  errors.push("Client Chat direct-main lease policy is invalid.");
}
if (
  profile.confirmation?.workflow !== "evavo-mainline-confirmation.yml" ||
  profile.confirmation?.required !== true ||
  profile.confirmation?.exactSourceShaRequired !== true ||
  profile.confirmation?.automaticTriggersAllowed !== false
) {
  errors.push("Client Chat exact-SHA confirmation policy is invalid.");
}
if (
  profile.security?.exactOriginAllowlistRequired !== true ||
  profile.security?.credentialedWildcardOriginAllowed !== false ||
  profile.security?.tenantAuthorizationSeparateFromOrigin !== true ||
  profile.security?.providerCredentialsInWidgetAllowed !== false ||
  profile.security?.unboundedChatContentLogsAllowed !== false
) {
  errors.push("Client Chat security defaults are invalid.");
}
const expectedEvidence = [
  "source-validation",
  "wrangler-dry-run",
  "origin-and-cors-contract",
  "storage-and-retention-contract",
  "widget-browser-smoke",
  "production-worker-smoke",
  "rollback-proof",
];
if (
  profile.releaseEvidence?.provider !== "github-status" ||
  profile.releaseEvidence?.statusPrefix !== "evavo/evidence/" ||
  profile.releaseEvidence?.maximumAgeHours !== 168 ||
  !Array.isArray(profile.releaseEvidence?.required) ||
  profile.releaseEvidence.required.length !== expectedEvidence.length ||
  expectedEvidence.some(
    (evidence, index) => profile.releaseEvidence.required[index] !== evidence,
  )
) {
  errors.push("Client Chat exact-SHA release evidence is invalid.");
}
if (
  profile.autoRepair?.allowed !== false ||
  !String(profile.autoRepair?.reason || "").includes("Production Worker smoke")
) {
  errors.push("Client Chat autonomous repair must remain disabled.");
}

requireTokens("Release contract", source.releaseContract, [
  'contract: "evavo_client_chat_release_contract_v1"',
  "single-package-manager-lock-required",
  "single-wrangler-config-required",
  "worker-source-anchor-missing",
  "widget-source-anchor-missing",
  "cloudflare-toolchain-anchor-missing",
  "security-origin-contract-topic-missing",
  "storage-contract-topic-missing",
  "automatic-github-actions-trigger-present",
  "productionWorkerSmokeExecuted: false",
  "rollbackExecuted: false",
  "providerMutationPerformed: false",
]);
forbidTokens("Release contract", source.releaseContract, [
  "spawnSync(",
  "execSync(",
  "fetch(",
  "git push",
  "wrangler deploy\n",
  "vercel deploy",
]);

requireTokens("Validation runner", source.runner, [
  'lockfilePolicy = "single-authoritative-lockfile"',
  'EVAVO_OFFLINE_PROVIDER_MODE: "true"',
  'EVAVO_SYNTHETIC_CHAT_FIXTURE: "true"',
  "safeEnvironment",
  "secretPatterns",
  'createHash("sha256")',
  "logsRedacted: true",
  "providerCredentialsInherited: false",
  "syntheticChatFixtureOnly: true",
  "productionWorkerSmokeProven: false",
  "rollbackProven: false",
  "deploymentPerformed: false",
  'contract: "evavo_client_chat_validation_v1"',
]);
forbidTokens("Validation runner", source.runner, [
  "GITHUB_TOKEN",
  "VERCEL_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "SSH_AUTH_SOCK",
  "git push",
  "wrangler deploy",
  "vercel deploy",
  "shell: true",
]);

requireTokens("Confirmation workflow", source.workflow, [
  "name: EVAVO mainline confirmation",
  "workflow_dispatch:",
  "expected_sha:",
  "request_source:",
  "source-worker",
  "widget-browser",
  "mode: source",
  "mode: browser",
  "persist-credentials: false",
  "actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955",
  "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  "node scripts/check-client-chat-governance-contract.mjs",
  "node scripts/check-client-chat-release-contract.mjs",
  "node scripts/run-client-chat-validation.mjs --mode ${{ matrix.mode }}",
]);
forbidTokens("Confirmation workflow", source.workflow, [
  "push:",
  "pull_request:",
  "schedule:",
  "workflow_run:",
  "wrangler deploy",
  "vercel deploy",
  "git push",
  "persist-credentials: true",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
]);

for (const [label, text] of [
  ["AGENTS.md", source.agents],
  ["CLAUDE.md", source.claude],
  ["Copilot instructions", source.copilot],
]) {
  requireTokens(label, text, [
    "active commercial",
    "portfolio:decision",
    "mainline-publish",
    "repository-main:EVAVO-STUDIO/client-chat-platform",
    "origin",
    "tenant",
    "evavo/evidence/",
  ]);
}
requireTokens("Security and origins", source.security, [
  "Exact origin allowlist",
  "wildcard origin is prohibited",
  "OPTIONS request is a preflight",
  "User or tenant authorization is separate from origin approval",
  "Request bounds",
  "content security policy (CSP)",
  "Synthetic fixtures",
]);
requireTokens("Storage and retention", source.storage, [
  "Tenant boundary",
  "Content minimisation",
  "Retention and expiry",
  "Deletion",
  "Backup and recovery",
  "must not resurrect records",
  "evavo/evidence/storage-and-retention-contract",
]);
requireTokens("Release evidence", source.evidence, [
  "evavo/evidence/source-validation",
  "evavo/evidence/wrangler-dry-run",
  "evavo/evidence/origin-and-cors-contract",
  "evavo/evidence/storage-and-retention-contract",
  "evavo/evidence/widget-browser-smoke",
  "evavo/evidence/production-worker-smoke",
  "evavo/evidence/rollback-proof",
  "SHA-256",
  "dedicated synthetic tenant",
  "release-evidence:publish",
]);

if (errors.length) {
  console.error("Client Chat governance contract check failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Client Chat governance contract check passed.");
console.log("- exact origins, authorization separation, request bounds and tenant isolation remain mandatory");
console.log("- source, dry-run, browser, production and rollback evidence remain distinct");
console.log("- source validation receives no Cloudflare credentials and performs no deploy");
console.log("- autonomous repair remains disabled until live provider and rollback proof exists");
