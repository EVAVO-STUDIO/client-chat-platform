#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(workerRoot, "src", "runtimeStorageBoundary.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const instrumented = source.replace(
  'import { sha256Hex } from "./security";',
  `async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("");
  }`,
);
if (instrumented === source) {
  throw new Error("RUNTIME_STORAGE_SECURITY_IMPORT_NOT_FOUND");
}

const compiled = ts.transpileModule(instrumented, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
  reportDiagnostics: true,
});
const diagnostics = compiled.diagnostics || [];
if (diagnostics.some((item) => item.category === ts.DiagnosticCategory.Error)) {
  throw new Error("RUNTIME_STORAGE_TRANSPILE_FAILED");
}
const boundary = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText, "utf8").toString("base64")}`
);

class FakeKV {
  constructor(entries = []) {
    this.values = new Map(entries);
    this.operations = [];
  }

  async get(key) {
    this.operations.push({ operation: "get", key: String(key) });
    return this.values.get(String(key)) ?? null;
  }

  async put(key, value, options) {
    const normalized = typeof value === "string" ? value : String(value);
    this.operations.push({
      operation: "put",
      key: String(key),
      value: normalized,
      options: options || null,
    });
    this.values.set(String(key), normalized);
  }

  async delete(key) {
    this.operations.push({ operation: "delete", key: String(key) });
    this.values.delete(String(key));
  }
}

function parsedConfig(kv, key) {
  return JSON.parse(kv.values.get(key));
}

async function responseJson(response) {
  return JSON.parse(await response.text());
}

{
  const existing = JSON.stringify({
    botId: "evavo",
    botKey: "existing-server-key-1234",
    actions: {
      actionsEnabled: true,
      allowedActionTypes: ["open_contact", "webhook"],
      webhookUrl: "https://hooks.invalid.test/retired",
      webhookSecret: "retired-value",
    },
    webhookUrl: "https://hooks.invalid.test/retired",
    webhookAuthHeader: "Authorization: retired",
    webhookSecret: "retired-value",
  });
  const kv = new FakeKV([["cfg:evavo", existing], ["cfg:index", '["evavo"]']]);
  const receipt = boundary.createBotConfigMutationReceipt();
  const protectedKv = boundary.withProtectedBotConfigWrites(kv, receipt);

  await protectedKv.put("cfg:evavo", JSON.stringify({
    botId: "evavo",
    botKey: "",
    siteName: "EVAVO Studio",
    actions: {
      actionsEnabled: true,
      allowedActionTypes: ["open_contact", "webhook"],
      webhookUrl: "https://hooks.invalid.test/retired",
      webhookSecret: "retired-value",
    },
    webhookUrl: "https://hooks.invalid.test/retired",
    webhookAuthHeader: "Authorization: retired",
    webhookSecret: "retired-value",
  }));

  const stored = parsedConfig(kv, "cfg:evavo");
  assert.equal(stored.botKey, "existing-server-key-1234");
  assert.equal(stored.webhookUrl, undefined);
  assert.equal(stored.webhookAuthHeader, undefined);
  assert.equal(stored.webhookSecret, undefined);
  assert.deepEqual(stored.actions, {
    actionsEnabled: true,
    allowedActionTypes: ["open_contact"],
  });
  assert.deepEqual(receipt, {
    botId: "evavo",
    botKeyConfigured: true,
    committed: true,
  });

  await protectedKv.put("cfg:index", '["evavo","second"]');
  assert.equal(kv.values.get("cfg:index"), '["evavo","second"]');
  await assert.rejects(
    protectedKv.put("cfg:../unsafe", JSON.stringify({ botId: "unsafe" })),
    /invalid_bot_configuration_write/,
  );

  const projected = await boundary.redactAdminConfigResponse(
    new Response(JSON.stringify({
      ok: true,
      cfg: {
        botId: "evavo",
        botKey: "",
        siteName: "EVAVO Studio",
        actions: stored.actions,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    "/admin/upsert",
    receipt,
  );
  const projectedPayload = await responseJson(projected);
  assert.equal(projectedPayload.cfg.botKey, undefined);
  assert.equal(projectedPayload.cfg.botKeyConfigured, true);
  assert.equal(projectedPayload.cfg.botKeyStatus, "configured");
  assert.equal(projectedPayload.configSecretsRedacted, true);
}

{
  const kv = new FakeKV([
    ["cfg:evavo", JSON.stringify({ botId: "evavo", botKey: "existing-server-key-1234" })],
  ]);
  const receipt = boundary.createBotConfigMutationReceipt();
  const protectedKv = boundary.withProtectedBotConfigWrites(kv, receipt);
  await protectedKv.put("cfg:evavo", JSON.stringify({
    botId: "evavo",
    botKey: boundary.BOT_KEY_CLEAR_SENTINEL,
  }));
  assert.equal(parsedConfig(kv, "cfg:evavo").botKey, "");
  assert.deepEqual(receipt, {
    botId: "evavo",
    botKeyConfigured: false,
    committed: true,
  });

  const projected = await boundary.redactAdminConfigResponse(
    new Response(JSON.stringify({
      ok: true,
      cfg: { botId: "evavo", botKey: boundary.BOT_KEY_CLEAR_SENTINEL },
    }), { headers: { "content-type": "application/json" } }),
    "/admin/upsert",
    receipt,
  );
  const payload = await responseJson(projected);
  assert.equal(payload.cfg.botKeyConfigured, false);
  assert.equal(payload.cfg.botKeyStatus, "not_configured");
}

{
  const projected = await boundary.redactAdminConfigResponse(
    new Response(JSON.stringify({
      ok: true,
      cfg: {
        botId: "evavo",
        botKey: "configured-server-key-1234",
        webhookSecret: "retired-value",
      },
    }), { headers: { "content-type": "application/json" } }),
    "/admin/get",
  );
  const payload = await responseJson(projected);
  assert.equal(payload.cfg.botKey, undefined);
  assert.equal(payload.cfg.webhookSecret, undefined);
  assert.equal(payload.cfg.botKeyConfigured, true);
  assert.equal(payload.cfg.botKeyStatus, "configured");
}

{
  const projected = await boundary.redactAdminConfigResponse(
    new Response("not-json", { headers: { "content-type": "application/json" } }),
    "/admin/get",
  );
  assert.equal(projected.status, 502);
  assert.deepEqual(await responseJson(projected), {
    ok: false,
    error: "invalid_internal_response",
  });
}

{
  const kv = new FakeKV([["rl:v2:already-hashed", "7"]]);
  const protectedKv = boundary.withHashedLegacyRateLimitKeys(kv);
  await protectedKv.put("rl:evavo:203.0.113.10:123", "1", { expirationTtl: 70 });
  const hashedPut = kv.operations.find(
    (item) => item.operation === "put" && item.value === "1",
  );
  assert.match(hashedPut.key, /^rl:v2:[0-9a-f]{64}$/);
  assert.equal(hashedPut.key.includes("203.0.113.10"), false);

  await protectedKv.get("rl:v2:already-hashed");
  const finalGet = kv.operations.at(-1);
  assert.equal(finalGet.key, "rl:v2:already-hashed");
}

console.log(JSON.stringify({
  passed: true,
  repository: "EVAVO-STUDIO/client-chat-platform",
  contract: "client-chat-runtime-storage-behaviour-v1",
  blankBotKeyPreserved: true,
  explicitBotKeyClearVerified: true,
  retiredCredentialsScrubbed: true,
  configIndexCompatibilityVerified: true,
  malformedConfigKeysRejected: true,
  committedMutationReceiptVerified: true,
  rawBotKeyProjected: false,
  malformedAdminJsonAccepted: false,
  rawClientAddressUsedAsKvKey: false,
  alreadyHashedRateLimitKeyRehashed: false,
}, null, 2));
