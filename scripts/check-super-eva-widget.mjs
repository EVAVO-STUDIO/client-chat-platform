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
  throw new Error(syntax.stderr || "SUPER EVA widget JavaScript syntax check failed");
}
for (const required of [
  "eva_super_presentation_v1",
  "evavo-avatar://eva-female/v1",
  "system-fallback",
  "approved-audio",
  "speechSynthesis",
  "prefers-reduced-motion",
  "stopVoice",
]) {
  if (!widget.includes(required)) throw new Error(`SUPER EVA widget missing: ${required}`);
}
for (const required of [
  "SUPER_EVA_PRESENTATION_VERSION",
  "parseSuperEvaChatPresentation",
  "evavo-storage://",
]) {
  if (!shared.includes(required)) throw new Error(`SUPER EVA shared contract missing: ${required}`);
}
if (/innerHTML\s*=|insertAdjacentHTML|eval\s*\(|new Function/u.test(widget)) {
  throw new Error("SUPER EVA widget contains a prohibited dynamic HTML/code surface");
}
console.log("SUPER EVA animated widget and presentation contract validated.");
