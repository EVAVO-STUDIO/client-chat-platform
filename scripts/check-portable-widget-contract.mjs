import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const embedUrl = new URL("widget/embed.js", root);
const superUrl = new URL("widget/super-eva-embed.js", root);
const readmeUrl = new URL("widget/README.md", root);
const boundaryUrl = new URL("docs/eva-product-boundary.md", root);

const [embed, superEva, readme, boundary] = await Promise.all([
  readFile(embedUrl, "utf8"),
  readFile(superUrl, "utf8"),
  readFile(readmeUrl, "utf8"),
  readFile(boundaryUrl, "utf8"),
]);

for (const target of [embedUrl, superUrl]) {
  const syntax = spawnSync(process.execPath, ["--check", target.pathname], {
    encoding: "utf8",
  });
  assert.equal(
    syntax.status,
    0,
    syntax.stderr || `widget syntax check failed: ${target.pathname}`,
  );
}

for (const required of [
  'script.getAttribute("data-api-base")',
  'script.getAttribute("data-bot-id")',
  'script.getAttribute("data-title")',
  'script.getAttribute("data-greeting")',
  'script.getAttribute("data-contact")',
  'script.getAttribute("data-accent")',
  'script.getAttribute("data-position")',
  'script.getAttribute("data-style-nonce")',
  'script.getAttribute("data-bot")',
  'host.attachShadow({ mode: "open" })',
  'credentials: "omit"',
  'redirect: "error"',
  'referrerPolicy: "no-referrer"',
  'POST',
  '/api/leads',
]) {
  assert.ok(embed.includes(required), `portable widget missing ${required}`);
}

for (const prohibited of [
  "localStorage",
  "sessionStorage",
  "data-theme",
  "data-brand-hex",
  "data-history",
  "data-max-history",
  "data-timeout-ms",
  "innerHTML =",
  "insertAdjacentHTML",
  "eval(",
]) {
  assert.ok(!embed.includes(prohibited), `portable widget retained ${prohibited}`);
}

for (const required of [
  "The canonical portable client is `widget/embed.js`.",
  "does **not** expose the older undocumented",
  "does not require persistent browser transcript storage",
  "must not become a second independent animation system",
  "prefer `embed.js`",
]) {
  assert.ok(readme.includes(required), `widget README missing ${required}`);
}

for (const stale of [
  "data-theme`: `auto | light | dark`",
  "persist chat locally",
  "data-position`: `br | bl | tr | tl`",
  "stores conversation history in `localStorage`",
]) {
  assert.ok(!readme.includes(stale), `widget README retained stale contract: ${stale}`);
}

for (const required of [
  "does **not** own EVA character art, animation semantics, lip-sync assets",
  "robust client primitive rather than the canonical EVA showcase",
  "without avatar assets or voice",
]) {
  assert.ok(boundary.includes(required), `EVA product boundary missing ${required}`);
}

assert.ok(
  superEva.includes("SUPER EVA standalone chat widget"),
  "SUPER EVA compatibility source unexpectedly missing",
);
assert.ok(
  !readme.includes("recommended)\n\nPaste this") &&
    !readme.includes("data-open=\"false\""),
  "obsolete portable-widget recommendation returned",
);

console.log("Portable widget contract passed.");
console.log("- embed.js remains the canonical credential-free Shadow DOM client");
console.log("- persistent transcript storage and retired data attributes remain absent");
console.log("- explicit lead consent stays separate from ordinary chat");
console.log("- SUPER EVA remains compatibility-only, not avatar-runtime authority");
