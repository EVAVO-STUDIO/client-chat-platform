#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outputDirectory = path.join(root, ".evavo-confirmation");
const outputPath = path.join(outputDirectory, "client-chat-release-contract.json");
const errors = [];
const warnings = [];

const absolute = (relativePath) => path.join(root, relativePath);
const exists = (relativePath) => fs.existsSync(absolute(relativePath));
const regularFile = (relativePath) => {
  const candidate = absolute(relativePath);
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
};
const readText = (relativePath) => fs.readFileSync(absolute(relativePath), "utf8");

if (!regularFile("package.json")) {
  throw new Error("package.json is required at the repository root.");
}
let packageDocument;
try {
  packageDocument = JSON.parse(readText("package.json"));
} catch (error) {
  throw new Error(
    `package.json is invalid JSON: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}
const scripts =
  packageDocument.scripts && typeof packageDocument.scripts === "object"
    ? packageDocument.scripts
    : {};
const dependencies = {
  ...(packageDocument.dependencies ?? {}),
  ...(packageDocument.devDependencies ?? {}),
};

const lockCandidates = [
  ["pnpm", "pnpm-lock.yaml"],
  ["npm", "package-lock.json"],
  ["yarn", "yarn.lock"],
  ["bun", "bun.lock"],
  ["bun", "bun.lockb"],
].filter(([, file]) => regularFile(file));
const lockManagers = [...new Set(lockCandidates.map(([manager]) => manager))];
if (lockManagers.length !== 1) {
  errors.push({
    code: "single-package-manager-lock-required",
    detail: lockCandidates.map(([, file]) => file),
  });
}
const packageManager = lockManagers[0] ?? null;
if (
  typeof packageDocument.packageManager !== "string" ||
  !packageDocument.packageManager.startsWith(`${packageManager ?? "missing"}@`)
) {
  errors.push({
    code: "exact-package-manager-field-required",
    detail: packageDocument.packageManager ?? null,
  });
}

const scriptGroups = Object.freeze({
  lint: ["lint"],
  typecheck: ["typecheck", "check:types", "types"],
  test: ["test", "test:unit", "check:test"],
  build: ["build"],
  release: ["release:verify", "verify:release", "quality:check", "check:all"],
  worker: [
    "worker:check",
    "wrangler:dry-run",
    "deploy:dry-run",
    "cloudflare:check",
  ],
  origin: [
    "origin:check",
    "cors:check",
    "security:origins",
    "test:origins",
  ],
  storage: [
    "storage:check",
    "retention:check",
    "data:check",
    "test:storage",
  ],
  widget: [
    "widget:check",
    "widget:browser-smoke",
    "test:widget",
    "browser:smoke",
  ],
  rollback: [
    "rollback:check",
    "release:rollback",
    "deployment:rollback-test",
    "worker:rollback-test",
  ],
});
const resolvedScripts = {};
for (const [group, candidates] of Object.entries(scriptGroups)) {
  const selected = candidates.find(
    (candidate) => typeof scripts[candidate] === "string" && scripts[candidate].trim(),
  );
  resolvedScripts[group] = selected ?? null;
  if (!selected) {
    errors.push({
      code: "required-package-script-group-missing",
      detail: `${group}: ${candidates.join(" | ")}`,
    });
  }
}

const unsafeScriptPattern =
  /(?:^|[;&|]\s*)(?:git\s+push|gh\s+(?:repo|pr)\s+create|wrangler\s+deploy(?!\s+--dry-run)|vercel\s+(?:deploy|--prod)|rm\s+-rf\s+[/~]|git\s+reset\s+--hard|git\s+push\s+[^\n]*--force)(?:\s|$)/i;
for (const [name, command] of Object.entries(scripts)) {
  if (typeof command !== "string" || command.length > 16_384) {
    errors.push({ code: "package-script-invalid", detail: name });
  } else if (unsafeScriptPattern.test(command)) {
    errors.push({ code: "package-script-has-provider-or-git-effect", detail: name });
  }
}

const wranglerFiles = ["wrangler.jsonc", "wrangler.toml"].filter(regularFile);
if (wranglerFiles.length !== 1) {
  errors.push({ code: "single-wrangler-config-required", detail: wranglerFiles });
}
const workerAnchors = ["src", "worker", "functions"].filter(exists);
if (workerAnchors.length === 0) {
  errors.push({ code: "worker-source-anchor-missing", detail: null });
}
const widgetAnchors = ["widget", "packages", "apps", "public/widget"].filter(exists);
if (widgetAnchors.length === 0) {
  errors.push({ code: "widget-source-anchor-missing", detail: null });
}
const cloudflareDependencies = [
  dependencies.wrangler,
  dependencies["@cloudflare/workers-types"],
  dependencies.miniflare,
].filter(Boolean);
if (cloudflareDependencies.length === 0) {
  errors.push({ code: "cloudflare-toolchain-anchor-missing", detail: null });
}

for (const document of [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "evavo.reliability.json",
  "docs/SECURITY_AND_ORIGINS.md",
  "docs/STORAGE_AND_RETENTION.md",
  "docs/RELEASE_EVIDENCE.md",
]) {
  if (!regularFile(document)) {
    errors.push({ code: "required-governance-file-missing", detail: document });
  }
}

if (regularFile("docs/SECURITY_AND_ORIGINS.md")) {
  const security = readText("docs/SECURITY_AND_ORIGINS.md").toLowerCase();
  for (const requirement of [
    ["allowlist", ["allowlist", "allowed origin"]],
    ["exact-origin", ["exact origin", "exact-match origin"]],
    ["preflight", ["preflight", "options request"]],
    ["credentials", ["credentials", "authorization"]],
    ["rate-limit", ["rate limit", "rate-limit"]],
    ["request-bounds", ["request bound", "body size"]],
    ["content-security-policy", ["content security policy", "csp"]],
    ["no-wildcard", ["no wildcard", "wildcard origin is prohibited"]],
  ]) {
    if (!requirement[1].some((token) => security.includes(token))) {
      errors.push({
        code: "security-origin-contract-topic-missing",
        detail: requirement[0],
      });
    }
  }
}
if (regularFile("docs/STORAGE_AND_RETENTION.md")) {
  const storage = readText("docs/STORAGE_AND_RETENTION.md").toLowerCase();
  for (const requirement of [
    ["tenant-boundary", ["tenant", "client boundary"]],
    ["retention", ["retention", "expiry"]],
    ["deletion", ["delete", "deletion"]],
    ["encryption", ["encrypt", "encryption"]],
    ["logs", ["log", "observability"]],
    ["content-minimisation", ["minimis", "minimum content"]],
    ["backup", ["backup", "recovery"]],
  ]) {
    if (!requirement[1].some((token) => storage.includes(token))) {
      errors.push({
        code: "storage-contract-topic-missing",
        detail: requirement[0],
      });
    }
  }
}

const stripComment = (line) => {
  let single = false;
  let double = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const previous = line[index - 1];
    if (character === "'" && !double && previous !== "\\") single = !single;
    if (character === '"' && !single && previous !== "\\") double = !double;
    if (character === "#" && !single && !double) return line.slice(0, index);
  }
  return line;
};
const workflowEvents = (source, file) => {
  const lines = source.split(/\r?\n/);
  const indexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/^on\s*:/.test(stripComment(lines[index]))) indexes.push(index);
  }
  if (indexes.length !== 1) {
    errors.push({
      code: "workflow-on-block-invalid",
      detail: path.relative(root, file),
    });
    return [];
  }
  const onIndex = indexes[0];
  const firstLine = stripComment(lines[onIndex]);
  const inline = firstLine.slice(firstLine.indexOf(":") + 1).trim();
  if (inline) {
    return inline
      .replace(/[\[\]{},]/g, " ")
      .split(/\s+/)
      .map((value) => value.replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
  const events = [];
  for (let index = onIndex + 1; index < lines.length; index += 1) {
    const line = stripComment(lines[index]);
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) break;
    const match = line.match(/^\s{2}([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
    if (match) events.push(match[1]);
  }
  return [...new Set(events)];
};
const workflowDirectory = absolute(".github/workflows");
const workflowFiles = fs.existsSync(workflowDirectory)
  ? fs
      .readdirSync(workflowDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .map((entry) => path.join(workflowDirectory, entry.name))
      .sort()
  : [];
if (
  !workflowFiles.some(
    (file) => path.basename(file) === "evavo-mainline-confirmation.yml",
  )
) {
  errors.push({ code: "exact-sha-confirmation-workflow-missing", detail: null });
}
const prohibitedEvents = new Set([
  "push",
  "pull_request",
  "pull_request_target",
  "schedule",
  "workflow_run",
  "repository_dispatch",
]);
const automaticWorkflowEvents = [];
for (const file of workflowFiles) {
  for (const event of workflowEvents(fs.readFileSync(file, "utf8"), file)) {
    if (prohibitedEvents.has(event)) {
      automaticWorkflowEvents.push({
        file: path.relative(root, file),
        event,
      });
    }
  }
}
if (automaticWorkflowEvents.length > 0) {
  errors.push({
    code: "automatic-github-actions-trigger-present",
    detail: automaticWorkflowEvents,
  });
}

if (!regularFile("docs/ROLLBACK.md")) {
  warnings.push({ code: "rollback-runbook-missing", detail: null });
}

const report = Object.freeze({
  passed: errors.length === 0,
  contract: "evavo_client_chat_release_contract_v1",
  generatedAt: new Date().toISOString(),
  repository: "EVAVO-STUDIO/client-chat-platform",
  packageManager,
  lockfiles: Object.freeze(lockCandidates.map(([, file]) => file)),
  resolvedScripts: Object.freeze(resolvedScripts),
  wranglerFiles: Object.freeze(wranglerFiles),
  workerAnchors: Object.freeze(workerAnchors),
  widgetAnchors: Object.freeze(widgetAnchors),
  workflowFiles: Object.freeze(
    workflowFiles.map((file) => path.relative(root, file)).sort(),
  ),
  automaticWorkflowEvents: Object.freeze(automaticWorkflowEvents),
  errors: Object.freeze(errors),
  warnings: Object.freeze(warnings),
  sourceValidationExecuted: false,
  wranglerDryRunExecuted: false,
  widgetBrowserSmokeExecuted: false,
  productionWorkerSmokeExecuted: false,
  rollbackExecuted: false,
  providerMutationPerformed: false,
});
fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
console.log(JSON.stringify({ ...report, outputPath }, null, 2));
if (!report.passed) process.exitCode = 1;
