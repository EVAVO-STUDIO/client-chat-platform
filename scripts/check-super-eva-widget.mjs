import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const widgetUrl = new URL("widget/super-eva-embed.js", root);
const sharedUrl = new URL("shared/superEvaPresentation.ts", root);
const readmeUrl = new URL("widget/README.md", root);
const boundaryUrl = new URL("docs/eva-product-boundary.md", root);
const [widget, shared, readme, boundary] = await Promise.all([
  readFile(widgetUrl, "utf8"),
  readFile(sharedUrl, "utf8"),
  readFile(readmeUrl, "utf8"),
  readFile(boundaryUrl, "utf8"),
]);
const syntax = spawnSync(process.execPath, ["--check", widgetUrl.pathname], {
  encoding: "utf8",
});
if (syntax.status !== 0) {
  throw new Error(
    syntax.stderr || "SUPER EVA widget JavaScript syntax check failed",
  );
}
for (const required of [
  "eva_super_presentation_v1",
  "evavo-avatar://eva-female/v1",
  "system-fallback",
  "approved-audio",
  "speechSynthesis",
  "prefers-reduced-motion",
  "stopVoice",
  "MAX_RESPONSE_CHUNKS",
  "reader.cancel",
  "presentation_hash_invalid",
  "evavo-storage://super-eva/presentations/",
  "authenticated resolver",
  'storeText: false',
  'wearable: Object.freeze({',
]) {
  if (!widget.includes(required)) {
    throw new Error(`SUPER EVA widget missing: ${required}`);
  }
}
for (const required of [
  "SUPER_EVA_PRESENTATION_VERSION",
  "parseSuperEvaChatPresentation",
  "superEvaPresentationContentMatches",
  "evavo-storage://",
  "EVAVO-STUDIO/evavo-glasses",
  "SUPER_EVA_CHAT_BINDING_INVALID",
]) {
  if (!shared.includes(required)) {
    throw new Error(`SUPER EVA shared contract missing: ${required}`);
  }
}
for (const prohibited of [
  /innerHTML\s*=/u,
  /insertAdjacentHTML/u,
  /eval\s*\(/u,
  /new Function/u,
  /new Audio\s*\(/u,
  /response\.text\s*\(/u,
  /safeAudioUrl/u,
]) {
  if (prohibited.test(widget)) {
    throw new Error(
      `SUPER EVA widget contains prohibited surface: ${prohibited}`,
    );
  }
}

assert.ok(
  readme.includes("`widget/super-eva-embed.js` is a compatibility experiment"),
  "SUPER EVA compatibility classification missing from widget documentation",
);
assert.ok(
  readme.includes("must not become a second independent animation system"),
  "SUPER EVA second-renderer prohibition missing",
);
assert.ok(
  boundary.includes("does **not** own EVA character art, animation semantics, lip-sync assets"),
  "chat-platform avatar ownership boundary missing",
);
assert.ok(
  boundary.includes("robust client primitive rather than the canonical EVA showcase"),
  "chat-platform showcase boundary missing",
);
assert.ok(
  !readme.includes("super-eva-embed.js` for production") &&
    !readme.includes("super-eva-embed.js` (recommended)"),
  "SUPER EVA compatibility widget was promoted as the canonical production embed",
);

console.log("SUPER EVA compatibility presentation contract validated.");
console.log("- response bytes and chunks are bounded before JSON parsing");
console.log("- presentation speech is hash-bound to the exact verified text");
console.log("- approved audio cannot bypass the EVAVO Storage resolver");
console.log("- SUPER EVA remains compatibility-only while avatar-runtime owns character presentation");
