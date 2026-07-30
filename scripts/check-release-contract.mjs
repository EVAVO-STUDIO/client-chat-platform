#!/usr/bin/env node

import fs from "node:fs";

const packageDocument = JSON.parse(fs.readFileSync("package.json", "utf8"));
const lockDocument = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const runtime = fs.readFileSync(".nvmrc", "utf8").trim();
const workflowPath = ".github/workflows/evavo-mainline-verification.yml";
const workflow = fs.existsSync(workflowPath)
  ? fs.readFileSync(workflowPath, "utf8")
  : "";
const errors = [];
const lockRoot = lockDocument.packages?.[""];

if (runtime !== "22.16.0") {
  errors.push(`.nvmrc must remain 22.16.0, found ${runtime || "empty"}.`);
}
if (lockDocument.lockfileVersion !== 3) {
  errors.push("package-lock.json must remain lockfileVersion 3.");
}
if (!lockRoot || lockRoot.name !== packageDocument.name || lockRoot.version !== packageDocument.version) {
  errors.push("package-lock root identity must match package.json.");
}
for (const field of ["dependencies", "devDependencies"]) {
  const expected = packageDocument[field] ?? {};
  const actual = lockRoot?.[field] ?? {};
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`package-lock root ${field} must exactly match package.json.`);
  }
  for (const [name, specification] of Object.entries(expected)) {
    if (["latest", "*"].includes(String(specification).trim())) {
      errors.push(`${field}.${name} must not use ${specification}.`);
    }
    if (String(specification).startsWith("file:../")) {
      errors.push(`${field}.${name} must not require a sibling checkout.`);
    }
  }
}

for (const [name, command] of Object.entries({
  test: "node --test test/**/*.test.mjs",
  typecheck: "tsc --noEmit",
  build: "wrangler deploy --dry-run --outdir dist",
})) {
  if (packageDocument.scripts?.[name] !== command) {
    errors.push(`package.json scripts.${name} must remain ${command}.`);
  }
}
const check = String(packageDocument.scripts?.check ?? "");
for (const command of [
  "npm run test",
  "npm run voice:contract:check",
  "npm run version:parity:check",
  "npm run typecheck",
  "npm run gateway:stub:check",
  "npm run export:purity:check",
]) {
  if (!check.includes(command)) errors.push(`package.json check must include ${command}.`);
}

for (const token of [
  "name: EVAVO mainline verification",
  "workflow_dispatch:",
  "expected_sha:",
  "request_source:",
  "group: client-chat-${{ inputs.expected_sha }}",
  "cancel-in-progress: false",
  "permissions:\n  contents: read",
  "ref: ${{ inputs.expected_sha }}",
  "fetch-depth: 0",
  "persist-credentials: false",
  "actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955",
  "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  "node-version-file: .nvmrc",
  "package-manager-cache: false",
  "npm install --global npm@10.9.2 --no-audit --no-fund",
  'test "$(npm --version)" = "10.9.2"',
  "node scripts/check-release-contract.mjs",
  "npm ci --no-audit --no-fund",
  "npm run check",
  "npm run build",
  '"deployment":"disabled"',
  '"providerCredentials":"not-required"',
  "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  "retention-days: 14",
]) {
  if (!workflow.includes(token)) {
    errors.push(`Verification workflow is missing ${token}.`);
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
const actions = workflow
  .split(/\r?\n/)
  .map((line) => line.match(/^\s*uses:\s*([^\s#]+).*$/)?.[1] ?? null)
  .filter(Boolean);
for (const action of actions) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$/.test(action)) {
    errors.push(`Verification action must be immutable: ${action}.`);
  }
}
for (const forbidden of [
  "contents: write",
  "packages: write",
  "pull-requests: write",
  "id-token: write",
  "persist-credentials: true",
  "wrangler deploy\n",
  "wrangler secret",
  "CLOUDFLARE_API_TOKEN",
  "secrets.",
  "git push",
  "git commit",
]) {
  if (workflow.includes(forbidden)) {
    errors.push(`Verification workflow contains forbidden ${forbidden}.`);
  }
}

const result = {
  schemaVersion: "1.0",
  repository: "EVAVO-STUDIO/client-chat-platform",
  ready: errors.length === 0,
  node: runtime,
  npm: "10.9.2",
  lockfileVersion: lockDocument.lockfileVersion ?? null,
  workflowMode: "dispatch-only-exact-sha",
  deploymentPerformed: false,
  providerCredentialsRequired: false,
  errors,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ready) process.exitCode = 1;
