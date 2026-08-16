#!/usr/bin/env node

import fs from "node:fs";

const NODE_VERSION = "24.19.0";
const NPM_VERSION = "11.17.0";
const WORKFLOW_PATHS = {
  ci: ".github/workflows/ci.yml",
  mainline: ".github/workflows/evavo-mainline-verification.yml",
  sentinel: ".github/workflows/sentinel.yml",
};
const errors = [];

function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${path} must remain valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

function readText(path) {
  try {
    return fs.readFileSync(path, "utf8");
  } catch (error) {
    errors.push(`${path} must remain readable: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalJson(nested)]),
    );
  }
  return value;
}

function requireTokens(label, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) errors.push(`${label} is missing ${token}.`);
  }
}

function requireOrder(label, source, tokens) {
  let cursor = -1;
  for (const token of tokens) {
    const index = source.indexOf(token, cursor + 1);
    if (index === -1) {
      errors.push(`${label} is missing ordered token ${token}.`);
      return;
    }
    if (index <= cursor) {
      errors.push(`${label} must keep ${token} in the declared order.`);
      return;
    }
    cursor = index;
  }
}

function validateLockfile(label, packageDocument, lockDocument) {
  const lockRoot = lockDocument.packages?.[""];
  if (lockDocument.lockfileVersion !== 3) {
    errors.push(`${label} package-lock.json must remain lockfileVersion 3.`);
  }
  if (!lockRoot) {
    errors.push(`${label} package-lock.json must retain its root package record.`);
    return;
  }
  for (const field of ["name", "version"]) {
    if ((lockRoot[field] ?? null) !== (packageDocument[field] ?? null)) {
      errors.push(`${label} package and lockfile root ${field} values must match.`);
    }
  }
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const declared = packageDocument[field] ?? {};
    const locked = lockRoot[field] ?? {};
    if (JSON.stringify(canonicalJson(declared)) !== JSON.stringify(canonicalJson(locked))) {
      errors.push(`${label} package-lock root ${field} must exactly match package.json.`);
    }
    for (const [name, specification] of Object.entries(declared)) {
      const normalized = String(specification).trim();
      if (["latest", "*"].includes(normalized.toLowerCase())) {
        errors.push(`${label} ${field}.${name} must not use ${normalized}.`);
      }
      if (/^file:\.\.[/\\]/.test(normalized)) {
        errors.push(`${label} ${field}.${name} must not require an undeclared sibling checkout.`);
      }
    }
  }
}

const rootPackage = readJson("package.json");
const rootLock = readJson("package-lock.json");
const workerPackage = readJson("worker/package.json");
const workerLock = readJson("worker/package-lock.json");
const runtime = readText(".nvmrc").trim();
const workflows = Object.fromEntries(
  Object.entries(WORKFLOW_PATHS).map(([name, path]) => [name, readText(path)]),
);
const workflow = workflows.mainline;

if (runtime !== NODE_VERSION) {
  errors.push(`.nvmrc must remain ${NODE_VERSION}, found ${runtime || "empty"}.`);
}
validateLockfile("root", rootPackage, rootLock);
validateLockfile("worker", workerPackage, workerLock);

const expectedRootScripts = {
  dev: "npm --prefix worker run dev",
  check: "npm --prefix worker run check",
  typecheck: "npm --prefix worker run typecheck",
  deploy: "npm --prefix worker run deploy",
  tail: "npm --prefix worker run tail",
  whoami: "npm --prefix worker run whoami",
};
const expectedWorkerScripts = {
  "check:source-secrets": "node scripts/check-source-secrets.mjs",
  "check:config-secrets:source": "node scripts/check-admin-config-secret-boundary.mjs",
  "check:config-secrets:behavior": "node scripts/check-runtime-storage-behaviour.mjs",
  "check:config-secrets": "npm run check:config-secrets:source && npm run check:config-secrets:behavior",
  "precheck:security": "npm run check:config-secrets",
  "check:security": "node scripts/check-security-contract.mjs",
  "check:super-eva": "node ../scripts/check-super-eva-widget.mjs",
  typecheck: "tsc -p tsconfig.json --noEmit",
  "check:bundle": "wrangler deploy --dry-run --outdir .wrangler/dry-run -c wrangler.jsonc",
  check: "npm run check:source-secrets && npm run check:security && npm run check:super-eva && npm run typecheck && npm run check:bundle",
  predeploy: "npm run check",
};
for (const [scope, scripts, expected] of [
  ["root", rootPackage.scripts ?? {}, expectedRootScripts],
  ["worker", workerPackage.scripts ?? {}, expectedWorkerScripts],
]) {
  for (const [name, command] of Object.entries(expected)) {
    if (scripts[name] !== command) {
      errors.push(`${scope} package.json script ${name} must equal: ${command}`);
    }
  }
}

requireTokens("Mainline verification workflow", workflow, [
  "name: EVAVO mainline verification",
  "workflow_dispatch:",
  "expected_sha:",
  "request_source:",
  "group: client-chat-${{ inputs.expected_sha }}",
  "cancel-in-progress: false",
  "permissions:\n  contents: read",
  "github.ref == 'refs/heads/main'",
  'test "$EXPECTED_SHA" = "$GITHUB_SHA"',
  'test "$REQUEST_SOURCE" = "evavo-development-studio"',
  "ref: ${{ inputs.expected_sha }}",
  "fetch-depth: 0",
  "persist-credentials: false",
  'test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"',
  'git merge-base --is-ancestor "$EXPECTED_SHA" origin/main',
  "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
  "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
  "node-version-file: .nvmrc",
  "cache-dependency-path: worker/package-lock.json",
  "package-manager-cache: false",
  'test "$(node --version)" = "v24.19.0"',
  'test "$(npm --version)" = "11.17.0"',
  "node scripts/check-release-contract.mjs",
  "npm --prefix worker ci --no-audit --no-fund",
  "npm --prefix worker run check",
  "git diff --exit-code",
  "git diff --cached --exit-code",
  "git status --porcelain=v1 --untracked-files=all",
  '"sourceMutation":"forbidden"',
  '"deployment":"disabled"',
  '"providerCredentials":"not-required"',
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  "retention-days: 14",
]);
requireOrder("Mainline verification workflow", workflow, [
  'test "$EXPECTED_SHA" = "$GITHUB_SHA"',
  "ref: ${{ inputs.expected_sha }}",
  'test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"',
  'test "$(node --version)" = "v24.19.0"',
  "node scripts/check-release-contract.mjs",
  "npm --prefix worker ci --no-audit --no-fund",
  "npm --prefix worker run check",
  "git diff --exit-code",
  "git diff --cached --exit-code",
  "git status --porcelain=v1 --untracked-files=all",
  '"sourceMutation":"forbidden"',
]);

requireTokens("CI workflow", workflows.ci, [
  "name: Client Chat source and Worker verification",
  "push:\n    branches: [main]",
  "pull_request:\n    branches: [main]",
  "workflow_dispatch:",
  "permissions:\n  contents: read",
  "cancel-in-progress: true",
  "runs-on: ubuntu-24.04",
  "timeout-minutes: 20",
  "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
  "persist-credentials: false",
  "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
  "node-version-file: .nvmrc",
  "cache-dependency-path: worker/package-lock.json",
  "package-manager-cache: false",
  'test "$(node --version)" = "v24.19.0"',
  'test "$(npm --version)" = "11.17.0"',
  "node scripts/check-release-contract.mjs",
  "npm --prefix worker ci --no-audit --no-fund",
  "npm --prefix worker run check",
  "git diff --exit-code",
  "git diff --cached --exit-code",
  "git status --porcelain=v1 --untracked-files=all",
]);
requireOrder("CI workflow", workflows.ci, [
  'test "$(node --version)" = "v24.19.0"',
  "node scripts/check-release-contract.mjs",
  "npm --prefix worker ci --no-audit --no-fund",
  "npm --prefix worker run check",
  "git diff --exit-code",
  "git diff --cached --exit-code",
  "git status --porcelain=v1 --untracked-files=all",
]);

requireTokens("Sentinel workflow", workflows.sentinel, [
  "name: Sentinel read-only repository diagnostics",
  "schedule:",
  'cron: "0 2 * * *"',
  "push:\n    branches: [main]",
  "pull_request:\n    branches: [main]",
  "workflow_dispatch:",
  "permissions:\n  contents: read",
  "cancel-in-progress: true",
  "runs-on: ubuntu-24.04",
  "timeout-minutes: 20",
  "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
  "persist-credentials: false",
  "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
  "node-version-file: .nvmrc",
  "cache-dependency-path: worker/package-lock.json",
  "package-manager-cache: false",
  'test "$(node --version)" = "v24.19.0"',
  'test "$(npm --version)" = "11.17.0"',
  "node scripts/check-release-contract.mjs",
  "npm --prefix worker ci --no-audit --no-fund",
  "npm --prefix worker run check",
  "git diff --exit-code",
  "git diff --cached --exit-code",
  "git status --porcelain=v1 --untracked-files=all",
  '"sourceMutation":"forbidden"',
  '"automaticCommit":false',
  '"automaticPush":false',
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  "retention-days: 14",
]);
requireOrder("Sentinel workflow", workflows.sentinel, [
  'test "$(node --version)" = "v24.19.0"',
  "node scripts/check-release-contract.mjs",
  "npm --prefix worker ci --no-audit --no-fund",
  "npm --prefix worker run check",
  "git diff --exit-code",
  "git diff --cached --exit-code",
  "git status --porcelain=v1 --untracked-files=all",
  '"sourceMutation":"forbidden"',
]);

for (const [label, source] of [
  ["CI workflow", workflows.ci],
  ["Sentinel workflow", workflows.sentinel],
]) {
  for (const forbidden of ["paths:", "paths-ignore:", "pull_request_target:", "workflow_run:", "repository_dispatch:"]) {
    if (source.includes(forbidden)) errors.push(`${label} contains forbidden ${forbidden}.`);
  }
}

for (const event of [
  "push",
  "pull_request",
  "pull_request_target",
  "schedule",
  "workflow_run",
  "repository_dispatch",
]) {
  if (new RegExp(`^  ${event}:`, "m").test(workflow)) {
    errors.push(`Verification workflow contains automatic event ${event}.`);
  }
}
for (const [label, source] of [
  ["CI workflow", workflows.ci],
  ["Mainline verification workflow", workflows.mainline],
  ["Sentinel workflow", workflows.sentinel],
]) {
  const actions = source
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*uses:\s*([^\s#]+).*$/)?.[1] ?? null)
    .filter(Boolean);
  for (const action of actions) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$/.test(action)) {
      errors.push(`${label} action must be immutable: ${action}.`);
    }
  }
  if (/^\s+[A-Za-z-]+:\s*write\s*(?:#.*)?$/m.test(source)) {
    errors.push(`${label} must not grant any write permission.`);
  }
  for (const forbidden of [
    "persist-credentials: true",
    "wrangler secret",
    "CLOUDFLARE_API_TOKEN",
    "secrets.",
    "git add",
    "git push",
    "git commit",
    "git reset",
    "sed -i",
    "perl -pi",
    "--force",
  ]) {
    if (source.includes(forbidden)) {
      errors.push(`${label} contains forbidden ${forbidden}.`);
    }
  }
}

const result = {
  schemaVersion: "2.0",
  repository: "EVAVO-STUDIO/client-chat-platform",
  ready: errors.length === 0,
  node: runtime,
  npm: NPM_VERSION,
  rootLockfileVersion: rootLock.lockfileVersion ?? null,
  workerLockfileVersion: workerLock.lockfileVersion ?? null,
  workflowMode: "dispatch-only-exact-sha",
  sourceMutationAllowed: false,
  deploymentPerformed: false,
  providerCredentialsRequired: false,
  errors,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ready) process.exitCode = 1;
