#!/usr/bin/env node

/**
 * Updates a bot config model in the Cloudflare Worker KV via the existing admin API.
 *
 * Required env:
 *   WORKER_URL   e.g. https://client-chat-platform.evavo-studio.workers.dev
 *   ADMIN_TOKEN  the Worker ADMIN_TOKEN secret
 *
 * Optional env:
 *   BOT_ID       defaults to evavo
 *   MODEL        defaults to @cf/meta/llama-3.3-70b-instruct-fp8-fast
 */

const WORKER_URL = String(process.env.WORKER_URL || "").replace(/\/+$/, "");
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || "").trim();
const BOT_ID = String(process.env.BOT_ID || "evavo").trim();
const MODEL = String(process.env.MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast").trim();

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!WORKER_URL) fail("Missing WORKER_URL. Example: $env:WORKER_URL='https://client-chat-platform.evavo-studio.workers.dev'");
if (!ADMIN_TOKEN) fail("Missing ADMIN_TOKEN. Set it to the same secret used by the Worker admin API.");
if (!BOT_ID) fail("Missing BOT_ID.");
if (!MODEL) fail("Missing MODEL.");

async function adminPost(path, body) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ADMIN_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, raw: text };
  }

  if (!res.ok || data?.ok === false) {
    const detail = data?.detail || data?.error || text || `HTTP ${res.status}`;
    fail(`${path} failed: ${detail}`);
  }

  return data;
}

console.log(`Reading bot config: ${BOT_ID}`);
const current = await adminPost("/admin/get", { botId: BOT_ID });
const cfg = current?.cfg;

if (!cfg || typeof cfg !== "object") {
  fail(`Bot config ${BOT_ID} was not returned by /admin/get.`);
}

const previousModel = String(cfg.model || "").trim() || "(Worker default)";
const nextCfg = {
  ...cfg,
  botId: cfg.botId || BOT_ID,
  model: MODEL,
};

console.log(`Updating model: ${previousModel} -> ${MODEL}`);
const updated = await adminPost("/admin/upsert", nextCfg);

console.log("Done. Updated bot config:");
console.log(JSON.stringify({ botId: updated?.cfg?.botId, model: updated?.cfg?.model, requestId: updated?.requestId }, null, 2));
