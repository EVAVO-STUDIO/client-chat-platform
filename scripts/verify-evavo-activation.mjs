#!/usr/bin/env node

const EXPECTED_RUNTIME = "client_chat_active_runtime_v2";
const EXPECTED_SECURITY_CONTRACT = "client_chat_hardened_router_v2";
const APPROVED_ORIGIN = "https://evavo.com.au";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_REPLY_CHARACTERS = 16_000;
const SENSITIVE_KEYS = new Set([
  "adminToken",
  "botKey",
  "cause",
  "model",
  "raw",
  "stack",
]);

function fail(code) {
  throw new Error(code);
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
  const local =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
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

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
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
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("EVAVO_CHAT_RESPONSE_INVALID_JSON");
  }
  const value = record(parsed);
  if (!value) fail("EVAVO_CHAT_RESPONSE_INVALID_JSON");
  return value;
}

async function fetchBoundedJson(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort("evavo-activation-verifier-deadline"),
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

function assertRuntime(response) {
  if (response.headers.get("x-evavo-chat-runtime") !== EXPECTED_RUNTIME) {
    fail("EVAVO_CHAT_RUNTIME_CONTRACT_MISMATCH");
  }
}

function assertNoSensitiveProjection(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoSensitiveProjection(entry, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key)) {
      fail(`EVAVO_CHAT_SENSITIVE_FIELD_EXPOSED:${path}.${key}`);
    }
    assertNoSensitiveProjection(entry, `${path}.${key}`);
  }
}

function assertNoImplicitLeadAction(value) {
  const action = record(value?.action);
  if (!action) return;
  if (action.type === "create_lead" || action.type === "webhook") {
    fail("EVAVO_CHAT_IMPLICIT_LEAD_ACTION_EXPOSED");
  }
}

function chatBody() {
  return JSON.stringify({
    botId: "evavo",
    messages: [
      {
        role: "user",
        content: "What does EVAVO specialise in?",
      },
    ],
  });
}

async function main() {
  const origin = workerOrigin(envText("EVAVO_CHAT_WORKER_URL"));

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
  assertRuntime(healthResponse);
  if (health.securityContract !== EXPECTED_SECURITY_CONTRACT) {
    fail("EVAVO_CHAT_SECURITY_CONTRACT_MISMATCH");
  }
  assertNoSensitiveProjection(health);

  const { response: browserResponse, value: browserChat } =
    await fetchBoundedJson(new URL("/api/chat", `${origin}/`), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        Origin: APPROVED_ORIGIN,
        Referer: `${APPROVED_ORIGIN}/`,
      },
      body: chatBody(),
    });
  assertRuntime(browserResponse);
  if (!browserResponse.ok || browserChat.ok !== true) {
    fail(`EVAVO_CHAT_APPROVED_ORIGIN_REJECTED:${browserResponse.status}`);
  }
  const reply =
    typeof browserChat.reply === "string"
      ? browserChat.reply.trim()
      : typeof browserChat.message === "string"
        ? browserChat.message.trim()
        : "";
  if (!reply || reply.length > MAX_REPLY_CHARACTERS) {
    fail("EVAVO_CHAT_APPROVED_ORIGIN_REPLY_INVALID");
  }
  if (browserChat.reply !== undefined && browserChat.message !== undefined) {
    if (String(browserChat.reply).trim() !== String(browserChat.message).trim()) {
      fail("EVAVO_CHAT_REPLY_MESSAGE_MISMATCH");
    }
  }
  assertNoSensitiveProjection(browserChat);
  assertNoImplicitLeadAction(browserChat);
  if (JSON.stringify(browserChat).includes("@cf/")) {
    fail("EVAVO_CHAT_MODEL_IDENTIFIER_EXPOSED");
  }

  const { response: serverResponse, value: serverChat } = await fetchBoundedJson(
    new URL("/api/chat", `${origin}/`),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: chatBody(),
    },
  );
  assertRuntime(serverResponse);
  if (
    serverResponse.status !== 401 ||
    serverChat.ok !== false ||
    serverChat.error !== "bot_key_required"
  ) {
    fail("EVAVO_CHAT_SERVER_AUTH_BOUNDARY_INVALID");
  }
  assertNoSensitiveProjection(serverChat);

  console.log("EVAVO deployed chat activation verified read-only.");
  console.log(`- runtime: ${EXPECTED_RUNTIME}`);
  console.log(`- approved origin: ${APPROVED_ORIGIN}`);
  console.log("- first-party origin succeeds without a bot key");
  console.log("- no-origin server request remains bot-key protected");
  console.log(`- bounded non-empty reply: ${reply.length} characters`);
  console.log("- public model response cannot expose create_lead or webhook actions");
  console.log("- no model identifier, bot key, raw provider output or stack/cause leaked");
  console.log("- no administrator token, KV mutation, seed apply or deployment was performed");
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.message : "EVAVO_CHAT_ACTIVATION_VERIFY_FAILED";
  console.error(message);
  process.exit(1);
});
