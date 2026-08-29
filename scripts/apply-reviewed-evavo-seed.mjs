#!/usr/bin/env node

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

function fail(code) {
  throw new Error(code);
}

function requireEqual(actual, expected, code) {
  if (actual !== expected) fail(code);
}

function requireJsonRecord(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}

function requireJsonEqual(actual, expected, code) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(code);
}

function envText(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function workerOrigin(value) {
  if (!value || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail("EVAVO_CHAT_WORKER_URL_REQUIRED");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("EVAVO_CHAT_WORKER_URL_INVALID");
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
    fail("EVAVO_CHAT_WORKER_URL_INVALID");
  }
  return parsed.origin;
}

function adminToken(value) {
  const bytes = new TextEncoder().encode(value).byteLength;
  if (!value || /\s/u.test(value) || bytes < 16 || bytes > 256) {
    fail("EVAVO_CHAT_ADMIN_TOKEN_INVALID");
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
    fail("EVAVO_CHAT_RESPONSE_TOO_LARGE");
  }
  if (!response.body) fail("EVAVO_CHAT_RESPONSE_EMPTY");

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
        fail("EVAVO_CHAT_RESPONSE_TOO_LARGE");
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
    fail("EVAVO_CHAT_RESPONSE_INVALID_JSON");
  }
  return requireJsonRecord(parsed, "EVAVO_CHAT_RESPONSE_INVALID_JSON");
}

async function fetchBoundedJson(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort("evavo-seed-deadline"),
    REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "error",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    });
    const value = await readBoundedJson(response);
    return { response, value };
  } catch (error) {
    if (controller.signal.aborted) fail("EVAVO_CHAT_REQUEST_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function adminPost(origin, token, pathname, body) {
  const { response, value } = await fetchBoundedJson(
    new URL(pathname, `${origin}/`),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok || value.ok !== true) {
    const code = typeof value.error === "string" ? value.error : "request_rejected";
    fail(`EVAVO_CHAT_ADMIN_REQUEST_FAILED:${pathname}:${response.status}:${code}`);
  }
  return value;
}

function assertReviewedConfig(value, seed) {
  const cfg = requireJsonRecord(value?.cfg, "EVAVO_CHAT_REVIEWED_CONFIG_MISSING");
  requireEqual(cfg.botId, "evavo", "EVAVO_CHAT_CONFIG_BOT_ID_MISMATCH");
  requireEqual(cfg.siteName, seed.siteName, "EVAVO_CHAT_CONFIG_SITE_NAME_MISMATCH");
  requireEqual(cfg.model, EXPECTED_MODEL, "EVAVO_CHAT_CONFIG_MODEL_MISMATCH");
  requireEqual(cfg.maxTokens, 320, "EVAVO_CHAT_CONFIG_MAX_TOKENS_MISMATCH");
  requireEqual(cfg.maxTurns, 8, "EVAVO_CHAT_CONFIG_MAX_TURNS_MISMATCH");
  requireEqual(
    cfg.maxCharsPerMessage,
    1400,
    "EVAVO_CHAT_CONFIG_MESSAGE_LIMIT_MISMATCH",
  );
  requireEqual(cfg.ragMode, "simple", "EVAVO_CHAT_CONFIG_RAG_MODE_MISMATCH");
  requireEqual(
    cfg.ragMaxUrlsPerRequest,
    1,
    "EVAVO_CHAT_CONFIG_RAG_URL_LIMIT_MISMATCH",
  );
  requireJsonEqual(
    cfg.allowedOrigins,
    seed.allowedOrigins,
    "EVAVO_CHAT_CONFIG_ORIGINS_MISMATCH",
  );
  requireJsonEqual(
    cfg.knowledgeUrls,
    seed.knowledgeUrls,
    "EVAVO_CHAT_CONFIG_KNOWLEDGE_URLS_MISMATCH",
  );
  requireJsonEqual(
    cfg.dailyBudget,
    seed.dailyBudget,
    "EVAVO_CHAT_CONFIG_DAILY_BUDGET_MISMATCH",
  );
  requireJsonEqual(
    cfg.rateLimit,
    seed.rateLimit,
    "EVAVO_CHAT_CONFIG_RATE_LIMIT_MISMATCH",
  );
  requireJsonEqual(
    cfg.actions,
    seed.actions,
    "EVAVO_CHAT_CONFIG_ACTIONS_MISMATCH",
  );
  requireEqual(
    Object.prototype.hasOwnProperty.call(cfg, "botKey"),
    false,
    "EVAVO_CHAT_CONFIG_SECRET_PROJECTION_INVALID",
  );
  if (
    typeof cfg.tone !== "string" ||
    !cfg.tone.includes("follow-up requires an explicit visitor-controlled action")
  ) {
    fail("EVAVO_CHAT_CONFIG_TONE_STALE");
  }
}

async function main() {
  const origin = workerOrigin(envText("EVAVO_CHAT_WORKER_URL"));
  const token = adminToken(envText("EVAVO_CHAT_ADMIN_TOKEN"));
  if (envText("EVAVO_CHAT_APPLY_SEED_CONFIRM") !== EXPECTED_CONFIRMATION) {
    fail(`EVAVO_CHAT_APPLY_SEED_CONFIRM_REQUIRED:${EXPECTED_CONFIRMATION}`);
  }

  const seedRaw = fs.readFileSync(seedPath, "utf8");
  if (!seedRaw || seedRaw.includes("\r")) fail("EVAVO_CHAT_REVIEWED_SEED_NON_CANONICAL");
  const seed = requireJsonRecord(
    JSON.parse(seedRaw),
    "EVAVO_CHAT_REVIEWED_SEED_INVALID",
  );
  requireEqual(seed.botId, "evavo", "EVAVO_CHAT_REVIEWED_SEED_BOT_ID_INVALID");
  requireEqual(seed.model, EXPECTED_MODEL, "EVAVO_CHAT_REVIEWED_SEED_MODEL_INVALID");

  const { response: healthResponse, value: health } = await fetchBoundedJson(
    new URL("/health", `${origin}/`),
    {
      method: "GET",
      headers: { accept: "application/json" },
    },
  );
  if (!healthResponse.ok || health.ok !== true) {
    fail(`EVAVO_CHAT_HEALTH_REJECTED:${healthResponse.status}`);
  }
  requireEqual(
    health.securityContract,
    EXPECTED_SECURITY_CONTRACT,
    "EVAVO_CHAT_SECURITY_CONTRACT_MISMATCH",
  );
  requireEqual(
    healthResponse.headers.get("x-evavo-chat-runtime"),
    EXPECTED_RUNTIME,
    "EVAVO_CHAT_RUNTIME_CONTRACT_MISMATCH",
  );

  const upserted = await adminPost(origin, token, "/admin/upsert", seed);
  assertReviewedConfig(upserted, seed);

  const stored = await adminPost(origin, token, "/admin/get", { botId: "evavo" });
  assertReviewedConfig(stored, seed);

  const refresh = await adminPost(origin, token, "/admin/kb/refresh", {
    botId: "evavo",
  });
  const attempted = Number(refresh.attempted ?? 0);
  const refreshed = Number(refresh.refreshed ?? 0);
  const failed = Number(refresh.failed ?? 0);
  if (!Number.isSafeInteger(attempted) || attempted < 1) {
    fail("EVAVO_CHAT_KNOWLEDGE_REFRESH_ATTEMPT_INVALID");
  }
  if (!Number.isSafeInteger(refreshed) || refreshed < 0) {
    fail("EVAVO_CHAT_KNOWLEDGE_REFRESH_COUNT_INVALID");
  }
  if (!Number.isSafeInteger(failed) || failed < 0) {
    fail("EVAVO_CHAT_KNOWLEDGE_FAILURE_COUNT_INVALID");
  }
  requireEqual(
    attempted,
    seed.knowledgeUrls.length,
    "EVAVO_CHAT_KNOWLEDGE_REFRESH_SCOPE_MISMATCH",
  );
  requireEqual(failed, 0, "EVAVO_CHAT_KNOWLEDGE_REFRESH_PARTIAL");
  requireEqual(
    refreshed,
    attempted,
    "EVAVO_CHAT_KNOWLEDGE_REFRESH_INCOMPLETE",
  );

  console.log("EVAVO reviewed production seed applied.");
  console.log(`- target runtime: ${EXPECTED_RUNTIME}`);
  console.log(`- reviewed model: ${EXPECTED_MODEL}`);
  console.log(
    `- bot limits: ${seed.maxTokens} completion tokens, ${seed.dailyBudget.maxRequestsPerDay} requests/day`,
  );
  console.log(`- approved knowledge refreshed: ${refreshed}/${attempted}`);
  console.log("- administrator token and raw bot configuration were not printed");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "EVAVO_CHAT_SEED_APPLY_FAILED";
  console.error(message);
  process.exit(1);
});
