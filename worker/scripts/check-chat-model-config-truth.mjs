#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(workerRoot, "src", "runtimeStorageBoundary.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const ACTIVE_MODEL = "@cf/zai-org/glm-4.7-flash";
const RETIRED_MODEL = "@cf/meta/llama-3.2-3b-instruct";

const instrumented = source.replace(
  'import { sha256Hex } from "./security";',
  `async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("");
  }`,
);
assert.notEqual(instrumented, source, "runtime storage security import must remain instrumentable");

const compiled = ts.transpileModule(instrumented, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
  reportDiagnostics: true,
});
assert.equal(
  (compiled.diagnostics || []).some(
    (item) => item.category === ts.DiagnosticCategory.Error,
  ),
  false,
  "runtime storage boundary must transpile for behavioral verification",
);
const boundary = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText, "utf8").toString("base64")}`
);

class FakeKV {
  constructor(entries = []) {
    this.values = new Map(entries);
  }
  async get(key) {
    return this.values.get(String(key)) ?? null;
  }
  async put(key, value) {
    this.values.set(String(key), typeof value === "string" ? value : String(value));
  }
  async delete(key) {
    this.values.delete(String(key));
  }
}

async function responseJson(response) {
  return JSON.parse(await response.text());
}

const kv = new FakeKV([
  [
    "cfg:evavo",
    JSON.stringify({
      botId: "evavo",
      botKey: "existing-server-key-1234",
      model: RETIRED_MODEL,
    }),
  ],
]);
const receipt = boundary.createBotConfigMutationReceipt();
const protectedKv = boundary.withProtectedBotConfigWrites(kv, receipt);
await protectedKv.put(
  "cfg:evavo",
  JSON.stringify({
    botId: "evavo",
    botKey: "",
    model: "@cf/example/unapproved-but-syntactically-valid",
    actions: { actionsEnabled: false, allowedActionTypes: ["none"] },
  }),
);

const stored = JSON.parse(kv.values.get("cfg:evavo"));
assert.equal(stored.model, ACTIVE_MODEL);
assert.equal(stored.botKey, "existing-server-key-1234");
assert.deepEqual(receipt, {
  botId: "evavo",
  botKeyConfigured: true,
  committed: true,
});

const projectedGet = await boundary.redactAdminConfigResponse(
  new Response(
    JSON.stringify({
      ok: true,
      cfg: {
        botId: "evavo",
        botKey: "existing-server-key-1234",
        model: RETIRED_MODEL,
      },
    }),
    { headers: { "content-type": "application/json" } },
  ),
  "/admin/get",
);
const getPayload = await responseJson(projectedGet);
assert.equal(getPayload.cfg.model, ACTIVE_MODEL);
assert.equal(getPayload.cfg.botKey, undefined);
assert.equal(getPayload.cfg.botKeyConfigured, true);
assert.equal(getPayload.cfg.botKeyStatus, "configured");

const projectedUpsert = await boundary.redactAdminConfigResponse(
  new Response(
    JSON.stringify({
      ok: true,
      cfg: {
        botId: "evavo",
        botKey: "",
        model: "@cf/example/unapproved-but-syntactically-valid",
      },
    }),
    { headers: { "content-type": "application/json" } },
  ),
  "/admin/upsert",
  receipt,
);
const upsertPayload = await responseJson(projectedUpsert);
assert.equal(upsertPayload.cfg.model, ACTIVE_MODEL);
assert.equal(upsertPayload.cfg.botKey, undefined);
assert.equal(upsertPayload.cfg.botKeyConfigured, true);

for (const required of [
  `const REVIEWED_CHAT_MODEL = "${ACTIVE_MODEL}";`,
  "next.model = REVIEWED_CHAT_MODEL;",
  "reviewedChatModelCanonicalizedOnConfigWrite: true",
  "reviewedChatModelCanonicalizedInAdminProjection: true",
  "reviewedChatModel: REVIEWED_CHAT_MODEL",
]) {
  assert.ok(source.includes(required), `model config truth boundary missing: ${required}`);
}

console.log("EVAVO chat stored-model truth check passed.");
console.log(`- reviewed stored/admin model: ${ACTIVE_MODEL}`);
console.log("- syntactically valid but unapproved model IDs cannot remain declared after a protected save");
console.log("- legacy/retired model IDs are projected as the reviewed model on admin reads");
console.log("- blank bot-key updates still preserve the existing server key");
