#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outputDirectory = path.join(root, ".evavo-confirmation");
const outputPath = path.join(outputDirectory, "client-chat-validation.json");
const lockfilePolicy = "single-authoritative-lockfile";
const modeIndex = process.argv.indexOf("--mode");
const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : null;
if (!["source", "browser"].includes(mode)) {
  throw new Error("--mode must be source or browser.");
}

const packageDocument = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const scripts = packageDocument.scripts ?? {};
const packageManagerField = String(packageDocument.packageManager || "");
const packageManagerMatch = packageManagerField.match(
  /^(npm|pnpm|yarn)@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)$/,
);
if (!packageManagerMatch) {
  throw new Error(
    "package.json packageManager must pin npm, pnpm or yarn to an exact semantic version.",
  );
}
const packageManager = packageManagerMatch[1];
const packageManagerVersion = packageManagerMatch[2];
const expectedLockfile = {
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
  yarn: "yarn.lock",
}[packageManager];
const observedLockfiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]
  .filter((candidate) => fs.existsSync(path.join(root, candidate)));
if (
  !fs.existsSync(path.join(root, expectedLockfile)) ||
  observedLockfiles.length !== 1 ||
  observedLockfiles[0] !== expectedLockfile
) {
  throw new Error(
    `${lockfilePolicy} requires exactly ${expectedLockfile}; observed ${
      observedLockfiles.join(", ") || "none"
    }.`,
  );
}

const scriptGroups = Object.freeze({
  lint: ["lint"],
  typecheck: ["typecheck", "check:types", "types"],
  test: ["test", "test:unit", "check:test"],
  build: ["build"],
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
  release: ["release:verify", "verify:release", "quality:check", "check:all"],
});
const selectedScripts = Object.fromEntries(
  Object.entries(scriptGroups).map(([group, candidates]) => {
    const selected = candidates.find(
      (candidate) => typeof scripts[candidate] === "string" && scripts[candidate].trim(),
    );
    if (!selected) {
      throw new Error(
        `Required ${group} package script is missing; expected one of ${candidates.join(", ")}.`,
      );
    }
    return [group, selected];
  }),
);

const safeEnvironment = Object.freeze({
  PATH: process.env.PATH ?? "",
  PATHEXT: process.env.PATHEXT ?? "",
  SYSTEMROOT: process.env.SYSTEMROOT ?? "",
  WINDIR: process.env.WINDIR ?? "",
  HOME: process.env.HOME ?? "",
  USERPROFILE: process.env.USERPROFILE ?? "",
  TEMP: process.env.TEMP ?? "",
  TMP: process.env.TMP ?? "",
  CI: "true",
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "Never",
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  npm_config_audit: "false",
  npm_config_fund: "false",
  npm_config_update_notifier: "false",
  EVAVO_OFFLINE_PROVIDER_MODE: "true",
  EVAVO_SYNTHETIC_CHAT_FIXTURE: "true",
});
const secretPatterns = [
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|AUTH)[A-Z0-9_]*)\s*[=:]\s*([^\s'";]+)/gi,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/gi,
];
const sanitise = (value) => {
  let text = String(value || "");
  for (const pattern of secretPatterns) {
    text = text.replace(pattern, (match, name) =>
      name && /^[A-Z0-9_]+$/.test(name) ? `${name}=<redacted>` : "<redacted>",
    );
  }
  return text;
};
const digest = (value) =>
  createHash("sha256").update(Buffer.from(String(value || ""), "utf8")).digest("hex");
const results = [];
const executable = (command) =>
  process.platform === "win32" && ["npm", "pnpm", "yarn", "corepack"].includes(command)
    ? `${command}.cmd`
    : command;
const writePartialReport = () => {
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        contract: "evavo_client_chat_validation_v1",
        mode,
        packageManager: packageManagerField,
        lockfilePolicy,
        selectedScripts,
        results,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
};
const run = (label, command, args, timeoutMilliseconds) => {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const result = spawnSync(executable(command), args, {
    cwd: root,
    env: safeEnvironment,
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
    timeout: timeoutMilliseconds,
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const logPath = path.join(
    outputDirectory,
    `${String(results.length + 1).padStart(2, "0")}-${label}.log`,
  );
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    logPath,
    `[stdout]\n${sanitise(stdout)}\n\n[stderr]\n${sanitise(stderr)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  const record = Object.freeze({
    label,
    command: [command, ...args],
    startedAt,
    durationSeconds: Math.round((Date.now() - started) / 100) / 10,
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal ?? null,
    timedOut: result.error?.code === "ETIMEDOUT",
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    stdoutSha256: digest(stdout),
    stderrSha256: digest(stderr),
    logPath: path.relative(root, logPath),
  });
  results.push(record);
  writePartialReport();
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(
      `${label} failed with ${
        result.status ?? result.signal ?? result.error?.code ?? "unknown"
      }; inspect ${path.relative(root, logPath)}.`,
    );
  }
};

if (packageManager !== "npm") {
  run(
    "activate-package-manager",
    "corepack",
    ["prepare", `${packageManager}@${packageManagerVersion}`, "--activate"],
    120_000,
  );
}
const installArguments = {
  npm: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
  pnpm: ["install", "--frozen-lockfile", "--ignore-scripts"],
  yarn: ["install", "--immutable", "--mode=skip-build"],
}[packageManager];
run("install", packageManager, installArguments, 900_000);
const runScript = (group, timeoutMilliseconds) =>
  run(
    `script-${group}`,
    packageManager,
    ["run", selectedScripts[group]],
    timeoutMilliseconds,
  );
for (const group of [
  "lint",
  "typecheck",
  "test",
  "build",
  "worker",
  "origin",
  "storage",
  "release",
]) {
  runScript(group, group === "build" || group === "release" ? 900_000 : 600_000);
}
if (mode === "browser") {
  runScript("widget", 900_000);
}

const report = Object.freeze({
  passed: true,
  contract: "evavo_client_chat_validation_v1",
  generatedAt: new Date().toISOString(),
  repository: "EVAVO-STUDIO/client-chat-platform",
  mode,
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  packageManager: packageManagerField,
  lockfilePolicy,
  authoritativeLockfile: expectedLockfile,
  selectedScripts: Object.freeze(selectedScripts),
  results: Object.freeze(results),
  logsRedacted: true,
  providerCredentialsInherited: false,
  syntheticChatFixtureOnly: true,
  providerMutationPerformed: false,
  productionWorkerSmokeProven: false,
  rollbackProven: false,
  deploymentPerformed: false,
  sourceMutationPerformed: false,
});
fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
console.log(JSON.stringify({ ...report, outputPath }, null, 2));
