#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const quickstartPath = path.join(workerRoot, "QUICKSTART.md");
const quickstart = fs.readFileSync(quickstartPath, "utf8");

assert.ok(quickstart.length > 0 && !quickstart.includes("\r"));

for (const required of [
  "The active deployed entrypoint is `src/runtime.ts`",
  "do not point Wrangler directly at `src/hardened.ts` or `src/index.ts`",
  'cmd /c "npm run check"',
  'cmd /c "npm run deploy"',
  "worker package's `predeploy` hook (`npm run check`)",
  "Do not use a direct `wrangler deploy` command for a routine release",
  "@cf/zai-org/glm-4.7-flash",
  "@cf/baai/bge-base-en-v1.5",
  "administrator console displays the chat model as read-only",
  'Authorization = "Bearer $ADMIN"',
  'allowedOrigins = @(',
  'tone = "Calm, concise, practical and specific.',
  'model = "@cf/zai-org/glm-4.7-flash"',
  "maxRequestsPerDay = 45",
  "maxTokensPerDay = 45000",
  'allowedActionTypes = @("open_contact", "create_lead")',
  'Admin-PostJson "/admin/kb/refresh"',
  "Public `/api/chat` requests never fetch configured source pages live",
  "The hardened public request contract uses a bounded `messages` array",
  'role = "user"',
  "The historical single `message` request shape is not part of the hardened public contract",
  "A model action cannot directly store a lead during `/api/chat`",
  "explicitly chooses **Share for follow-up**",
  "consent: true",
  "expire after 90 days",
]) {
  assert.ok(quickstart.includes(required), `worker quickstart missing: ${required}`);
}

for (const prohibited of [
  "temperature =",
  "systemPrompt =",
  "dailyBudget = @{ limit =",
  "requests/day (hard stop)",
  "Legacy format is also supported",
  "Leads saved from create_lead actions",
  "x-admin-token",
  "localStorage",
  "sessionStorage",
  "wrangler deploy -c wrangler.jsonc",
]) {
  assert.ok(!quickstart.includes(prohibited), `worker quickstart retained stale or unsafe guidance: ${prohibited}`);
}

console.log("Worker hardened quickstart contract passed.");
console.log("- active runtime and guarded root-to-worker deployment lifecycle are explicit");
console.log("- reviewed GLM/BGE model ownership and read-only admin model state are documented");
console.log("- examples use current schema fields and exact Bearer administration");
console.log("- public chat uses bounded messages and cached-only knowledge");
console.log("- visitor follow-up remains explicit-consent only; retired single-message/direct-lead guidance is absent");
