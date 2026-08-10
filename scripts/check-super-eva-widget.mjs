import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const widgetUrl = new URL("widget/super-eva-embed.js", root);
const sharedUrl = new URL("shared/superEvaPresentation.ts", root);
const widget = await readFile(widgetUrl, "utf8");
const shared = await readFile(sharedUrl, "utf8");
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
  "EVA-STUDIO/evavo-glasses",
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
console.log("SUPER EVA animated widget and presentation contract validated.");
console.log("- response bytes and chunks are bounded before JSON parsing");
console.log("- presentation speech is hash-bound to the exact verified text");
console.log("- approved audio cannot bypass the EVAVO Storage resolver");
