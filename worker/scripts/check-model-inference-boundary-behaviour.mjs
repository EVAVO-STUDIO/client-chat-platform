#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(workerRoot, "src", "modelInferenceBoundary.ts");
const buildRoot = path.join(workerRoot, ".model-inference-boundary-test-build");
const outputPath = path.join(buildRoot, "modelInferenceBoundary.mjs");
const source = fs.readFileSync(sourcePath, "utf8");

assert.ok(source.length > 0 && !source.includes("\r"));
assert.ok(!source.includes("fetch("));
assert.ok(!source.includes("process.env"));
assert.ok(!source.includes("KVNamespace"));
assert.ok(!source.includes("@cf/"));

function transpile() {
  const result = ts.transpileModule(source, {
    fileName: "modelInferenceBoundary.ts",
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: true,
      isolatedModules: true,
      removeComments: false,
    },
  });
  const diagnostics = result.diagnostics ?? [];
  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(
    errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    [],
    "pure inference boundary must transpile without TypeScript errors",
  );
  return result.outputText;
}

function expectError(classify, request, expected) {
  let thrown = null;
  try {
    classify([request]);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Error, `expected ${expected}`);
  assert.equal(thrown.message, expected);
}

try {
  fs.rmSync(buildRoot, { recursive: true, force: true });
  fs.mkdirSync(buildRoot, { recursive: true });
  fs.writeFileSync(outputPath, transpile(), "utf8");

  const moduleUrl = `${pathToFileURL(outputPath).href}?v=${Date.now()}`;
  const boundary = await import(moduleUrl);
  const classify = boundary.classifyModelInferenceKind;

  assert.equal(typeof classify, "function");
  assert.equal(boundary.MODEL_EMBEDDING_MAX_TEXT_CHARS, 2_000);
  assert.equal(boundary.MODEL_EMBEDDING_MAX_BATCH_ITEMS, 24);
  assert.deepEqual(boundary.modelInferenceBoundaryPosture, {
    contract: "client_chat_model_inference_boundary_v1",
    chatMessagesMustBeNonEmpty: true,
    chatMessagesMustUseReviewedRolesAndNonEmptyText: true,
    embeddingTextMaximumCharacters: 2_000,
    embeddingBatchMaximumItems: 24,
    embeddingBatchItemsMustBeBoundedStrings: true,
    whitespaceOnlyEmbeddingTextRejected: true,
    mixedChatAndEmbeddingShapeRejected: true,
    dualEmbeddingInputFormsRejected: true,
    unknownInferenceShapeRejected: true,
    providerAuthority: false,
    networkAuthority: false,
    storageAuthority: false,
  });

  assert.equal(
    classify([{ messages: [{ role: "user", content: "hello" }] }]),
    "chat",
  );
  assert.equal(
    classify([
      {
        messages: [
          { role: "system", content: "Use approved evidence." },
          { role: "user", content: "hello" },
          { role: "assistant", content: "Hi." },
        ],
      },
    ]),
    "chat",
  );
  assert.equal(classify([{ text: "hello" }]), "embedding");
  assert.equal(classify([{ text: "x".repeat(2_000) }]), "embedding");
  assert.equal(classify([{ text: ["hello"] }]), "embedding");
  assert.equal(
    classify([{ text: Array.from({ length: 24 }, (_, index) => `chunk-${index}`) }]),
    "embedding",
  );
  assert.equal(classify([{ texts: ["legacy"] }]), "embedding");

  expectError(classify, null, "model_request_shape_not_approved");
  expectError(classify, [], "model_request_shape_not_approved");
  expectError(classify, {}, "model_request_shape_not_approved");
  expectError(classify, { messages: [] }, "model_request_shape_not_approved");
  expectError(classify, { messages: "hello" }, "model_request_shape_not_approved");
  expectError(
    classify,
    { messages: [42] },
    "model_request_shape_not_approved",
  );
  expectError(
    classify,
    { messages: [{ role: "tool", content: "hello" }] },
    "model_request_shape_not_approved",
  );
  expectError(
    classify,
    { messages: [{ role: "user", content: "   " }] },
    "model_request_shape_not_approved",
  );
  expectError(
    classify,
    { messages: [{ role: "user", content: 42 }] },
    "model_request_shape_not_approved",
  );
  expectError(classify, { text: "" }, "model_request_shape_not_approved");
  expectError(classify, { text: "   " }, "model_request_shape_not_approved");
  expectError(
    classify,
    { text: "x".repeat(2_001) },
    "model_request_shape_not_approved",
  );
  expectError(classify, { text: [] }, "model_request_shape_not_approved");
  expectError(
    classify,
    { text: Array.from({ length: 25 }, () => "chunk") },
    "model_request_shape_not_approved",
  );
  expectError(
    classify,
    { text: ["valid", "   "] },
    "model_request_shape_not_approved",
  );
  expectError(
    classify,
    { text: ["valid", 42] },
    "model_request_shape_not_approved",
  );
  expectError(classify, { texts: [] }, "model_request_shape_not_approved");
  expectError(
    classify,
    { messages: [{ role: "user", content: "hello" }], text: "also embed" },
    "model_request_shape_ambiguous",
  );
  expectError(
    classify,
    { messages: [{ role: "user", content: "hello" }], texts: ["also embed"] },
    "model_request_shape_ambiguous",
  );
  expectError(
    classify,
    { text: "one", texts: ["two"] },
    "model_request_shape_ambiguous",
  );
  expectError(
    classify,
    { messages: [{ role: "user", content: "hello" }], text: null },
    "model_request_shape_ambiguous",
  );
  expectError(classify, { prompt: "hello" }, "model_request_shape_not_approved");

  console.log("EVAVO model inference boundary behavior passed.");
  console.log("- chat messages use only reviewed roles with non-empty string content");
  console.log("- scalar and batch embedding text are bounded to 2,000 characters and 24 items");
  console.log("- whitespace, mixed types, oversized batches and unknown shapes fail closed");
  console.log("- chat plus embedding inputs and dual text/texts forms fail as ambiguous");
  console.log("- the executed classifier has no network, provider or storage authority");
} finally {
  fs.rmSync(buildRoot, { recursive: true, force: true });
}
