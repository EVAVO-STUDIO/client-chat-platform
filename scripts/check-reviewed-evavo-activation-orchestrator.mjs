#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(root, "scripts", "activate-reviewed-evavo-worker.ps1");
const source = fs.readFileSync(scriptPath, "utf8");
const stat = fs.lstatSync(scriptPath);

assert.ok(stat.isFile(), "activation orchestrator must be a regular file");
assert.ok(!stat.isSymbolicLink(), "activation orchestrator must not be a symlink");
assert.ok(source.length > 0 && !source.includes("\r"), "activation orchestrator must be LF-only");

for (const required of [
  "[ValidatePattern('^[0-9a-f]{40}$')]",
  "$ExpectedConfirmation = 'DEPLOY_AND_ACTIVATE_REVIEWED_EVAVO'",
  "$SeedConfirmation = 'APPLY_EVAVO_REVIEWED_SEED'",
  "git rev-parse HEAD",
  "git branch --show-current",
  "git status --porcelain=v1 --untracked-files=all",
  "'EVAVO_CHAT_EXPECTED_SHA_MISMATCH'",
  "'EVAVO_CHAT_MAIN_BRANCH_REQUIRED'",
  "'EVAVO_CHAT_CLEAN_CHECKOUT_REQUIRED'",
  "Require-Env 'EVAVO_CHAT_ACTIVATE_CONFIRM'",
  "Require-Env 'EVAVO_CHAT_WORKER_URL'",
  "Require-Env 'EVAVO_CHAT_ADMIN_TOKEN'",
  "Invoke-Checked 'EVAVO_CHAT_DEPLOY' @('npm', 'run', 'deploy')",
  "Invoke-Checked 'EVAVO_CHAT_SEED_APPLY' @('npm', 'run', 'apply:evavo-seed')",
  "Invoke-Checked 'EVAVO_CHAT_ACTIVATION_VERIFY' @('npm', 'run', 'verify:evavo-activation')",
  "[Environment]::SetEnvironmentVariable('EVAVO_CHAT_APPLY_SEED_CONFIRM', $SeedConfirmation, 'Process')",
  "'EVAVO_CHAT_CHECKOUT_MUTATED_DURING_ACTIVATION'",
  "first-party approved-origin chat was verified without a bot-key credential",
  "administrator token was not printed and remains process-local",
]) {
  assert.ok(source.includes(required), `activation orchestrator missing: ${required}`);
}

const deployIndex = source.indexOf("Invoke-Checked 'EVAVO_CHAT_DEPLOY'");
const seedIndex = source.indexOf("Invoke-Checked 'EVAVO_CHAT_SEED_APPLY'");
const verifyIndex = source.indexOf("Invoke-Checked 'EVAVO_CHAT_ACTIVATION_VERIFY'");
assert.ok(
  deployIndex >= 0 && seedIndex > deployIndex && verifyIndex > seedIndex,
  "activation order must remain deploy -> seed/cache -> read-only verify",
);

for (const forbidden of [
  "wrangler deploy",
  "npx wrangler",
  "git push",
  "git reset",
  "git checkout",
  "git switch",
  "git clean",
  "Invoke-WebRequest",
  "Invoke-RestMethod",
  "curl.exe",
  "ADMIN_TOKEN=",
  "EVAVO_CHAT_ADMIN_TOKEN=",
  "Write-Host $AdminToken",
  "Write-Output $AdminToken",
  "Set-Content",
  "Out-File",
  "Remove-Item -Recurse",
]) {
  assert.ok(!source.includes(forbidden), `activation orchestrator contains forbidden authority/material: ${forbidden}`);
}

assert.equal(
  (source.match(/npm', 'run', 'deploy/g) ?? []).length,
  1,
  "activation orchestrator must have exactly one guarded deploy invocation",
);
assert.equal(
  (source.match(/EVAVO_CHAT_ADMIN_TOKEN/g) ?? []).length,
  2,
  "administrator token should only be required and validated, never copied elsewhere",
);

console.log("EVAVO Windows activation orchestrator contract passed.");
console.log("- exact SHA, main branch, clean checkout and explicit confirmation are required before deployment");
console.log("- deployment uses only the canonical npm lifecycle");
console.log("- reviewed seed/cache mutation follows deployment and read-only verification follows mutation");
console.log("- no direct Wrangler, Git mutation, HTTP shortcut or embedded credential authority is present");
console.log("- administrator token remains process-local and is never intentionally printed");
