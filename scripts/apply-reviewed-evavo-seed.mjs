#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seedPath = path.join(root, "worker", "upsert-evavo.json");
const EXPECTED_CONFIRMATION = "APPLY_EVAVO_REVIEWED_SEED";
const EXPECTED_RUNTIME = "client_chat_active_runtime_v2";
const EXPECTED_SECURITY_CONTRACT = "client_chat_hardened_router_v2";
const EXPECTED_MODEL = "@cf/zai-org/glm-4.7-flash";
const MAX_RESPONSE_BYTES = 128 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

function envText(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function workerOrigin(value) {
  if (!value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("EVAVO_CHAT_WORKER_URL_REQUIRED");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("EVAVO_CHAT_WORKER_URL_INVALID");
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:"))
  ) {
    throw new Error("EVAVO_CHAT_WORKER_URL_INVALID");
  }
  return parsed.origin;
}

function adminToken(value) {
  const bytes = new TextEncoder().encode(value).byteLength;
  if (!value || /\s/u.test(value) || bytes < 16 || bytes > 256) {
    throw new Error("EVAVO_CHAT_ADMIN_TOKEN_INVALID");
  }
  return value;
}

async function readBoundedJson(response) {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("EVAVO_CHAT_RESPONSE_TOO_LARGE");
  }
  if (!response.body) throw new Error("EVAVO_CHAT_RESPONSE_EMPTY");

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("EVAVO_CHAT_RESPONSE_TOO_LARGE");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("EVAVO_CHAT_RESPONSE_INVALID_JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("EVAVO_CHAT_RESPONSE_INVALID_JSON");
  }
  return parsed;
}

async function boundedFetch(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("evavo-seed-deadline"), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "error",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function adminPost(origin, token, pathname, body) {
  const response = await boundedFetch(new URL(pathname, `${origin}/`), {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const value = await readBoundedJson(response);
  if (!response.ok || value.ok !== true) {
    const code = typeof value.error === "string" ? value.error : "request_rejected";
    throw new Error(`EVAVO_CHAT_ADMIN_REQUEST_FAILED:${pathname}:${response.status}:${code}`);
  }
  return value;
}

function assertReviewedConfig(value, seed) {
  const cfg = value?.cfg;
  assert.ok(cfg && typeof cfg === "object" && !Array.isArray(cfg), "reviewed config projection missing");
  assert.equal(cfg.botId, "evavo");
  assert.equal(cfg.siteName, seed.siteName);
  assert.equal(cfg.model, EXPECTED_MODEL);
  assert.equal(cfg.maxTokens, 320);
  assert.equal(cfg.maxTurns, 8);
  assert.equal(cfg.maxCharsPerMessage, 1400);
  assert.equal(cfg.ragMode, "simple");
  assert.equal(cfg.ragMaxUrlsPerRequest, 1);
  assert.deepEqual(cfg.allowedOrigins, seed.allowedOrigins);
  assert.deepEqual(cfg.knowledgeUrls, seed.knowledgeUrls);
  assert.deepEqual(cfg.dailyBudget, seed.dailyBudget);
  assert.deepEqual(cfg.rateLimit, seed.rateLimit);
  assert.deepEqual(cfg.actions, seed.actions);
  assert.equal(Object.prototype.hasOwnProperty.call(cfg, "botKey"), false);
  assert.ok(
    typeof cfg.tone === "string" &&
      cfg.tone.includes("follow-up requires an explicit visitor-controlled action"),
    "reviewed EVAVO tone projection is stale",
  );
}

async function main() {
  const origin = workerOrigin(envText("EVAVO_CHAT_WORKER_URL"));
  const token = adminToken(envText("EVAVO_CHAT_ADMIN_TOKEN"));
  if (envText("EVAVO_CHAT_APPLY_SEED_CONFIRM") !== EXPECTED_CONFIRMATION) {
    throw new Error(`EVAVO_CHAT_APPLY_SEED_CONFIRM_REQUIRED:${EXPECTED_CONFIRMATION}`);
  }

  const seedRaw = fs.readFileSync(seedPath, "utf8");
  assert.ok(seedRaw.length > 0 && !seedRaw.includes("\r"), "reviewed seed is missing or non-canonical");
  const seed = JSON.parse(seedRaw);
  assert.equal(seed.botId, "evavo");
  assert.equal(seed.model, EXPECTED_MODEL);

  const healthResponse = await boundedFetch(new URL("/health", `${origin}/`), {
    method: "GET",
    headers: { accept: "application/json" },
  });
  const health = await readBoundedJson(healthResponse);
  if (!healthResponse.ok || health.ok !== true) {
    throw new Error(`EVAVO_CHAT_HEALTH_REJECTED:${healthResponse.status}`);
  }
  assert.equal(health.securityContract, EXPECTED_SECURITY_CONTRACT);
  assert.equal(healthResponse.headers.get("x-evavo-chat-runtime"), EXPECTED_RUNTIME);

  const upserted = await adminPost(origin, token, "/admin/upsert", seed);
  assertReviewedConfig(upserted, seed);

  const stored = await adminPost(origin, token, "/admin/get", { botId: "evavo" });
  assertReviewedConfig(stored, seed);

  const refresh = await adminPost(origin, token, "/admin/kb/refresh", { botId: "evavo" });
  const attempted = Number(refresh.attempted ?? 0);
  const refreshed = Number(refresh.refreshed ?? 0);
  const failed = Number(refresh.failed ?? 0);
  assert.equal(Number.isSafeInteger(attempted) && attempted >= 1, true);
  assert.equal(Number.isSafeInteger(refreshed) && refreshed >= 0, true);
  assert.equal(Number.isSafeInteger(failed) && failed >= 0, true);
  assert.equal(attempted, seed.knowledgeUrls.length);
  assert.equal(failed, 0, "approved knowledge refresh was partial");
  assert.equal(refreshed, attempted, "approved knowledge refresh did not complete");

  console.log("EVAVO reviewed production seed applied.");
  console.log(`- target runtime: ${EXPECTED_RUNTIME}`);
  console.log(`- reviewed model: ${EXPECTED_MODEL}`);
  console.log(`- bot limits: ${seed.maxTokens} completion tokens, ${seed.maxRequestsPerDay ?? seed.dailyBudget.maxRequestsPerDay} requests/day`);
  console.log(`- approved knowledge refreshed: ${refreshed}/${attempted}`);
  console.log("- administrator token and raw bot configuration were not printed");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "EVAVO_CHAT_SEED_APPLY_FAILED";
  console.error(message);
  process.exit(1);
});
