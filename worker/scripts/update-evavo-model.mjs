#!/usr/bin/env node

/**
 * Updates a bot config in the Cloudflare Worker KV via the existing admin API.
 * The default path applies EVAVO's public demo policy: balanced model, expert tone,
 * curated knowledge, simple RAG and strict public usage caps.
 *
 * Required env:
 *   WORKER_URL   e.g. https://client-chat-platform.evavo-studio.workers.dev
 *   ADMIN_TOKEN  the Worker ADMIN_TOKEN secret
 *
 * Optional env:
 *   BOT_ID                 defaults to evavo
 *   MODEL                  defaults to @cf/meta/llama-3.2-3b-instruct
 *   ONLY_MODEL             set true to update only the model
 *   MAX_TOKENS             defaults to 320
 *   MAX_TURNS              defaults to 8
 *   MAX_CHARS_PER_MESSAGE  defaults to 1400
 *   RATE_LIMIT             defaults to 5
 *   RATE_WINDOW_SECONDS    defaults to 60
 *   DAILY_REQUESTS         defaults to 45
 *   DAILY_TOKENS           defaults to 45000
 */

const WORKER_URL = String(process.env.WORKER_URL || "").replace(/\/+$/, "");
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || "").trim();
const BOT_ID = String(process.env.BOT_ID || "evavo").trim();
const MODEL = String(process.env.MODEL || "@cf/meta/llama-3.2-3b-instruct").trim();
const ONLY_MODEL = String(process.env.ONLY_MODEL || "").toLowerCase() === "true";

function intEnv(name, fallback, min, max) {
  const raw = process.env[name];
  const n = raw == null || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

const MAX_TOKENS = intEnv("MAX_TOKENS", 320, 64, 1024);
const MAX_TURNS = intEnv("MAX_TURNS", 8, 4, 30);
const MAX_CHARS_PER_MESSAGE = intEnv("MAX_CHARS_PER_MESSAGE", 1400, 200, 8000);
const RATE_LIMIT = intEnv("RATE_LIMIT", 5, 1, 120);
const RATE_WINDOW_SECONDS = intEnv("RATE_WINDOW_SECONDS", 60, 10, 3600);
const DAILY_REQUESTS = intEnv("DAILY_REQUESTS", 45, 0, 100000);
const DAILY_TOKENS = intEnv("DAILY_TOKENS", 45000, 0, 50000000);

const EVAVO_TONE =
  "EVAVO voice: calm, sharp, minimal, practical, premium and human. Sound like a senior digital studio partner, not a generic AI assistant. Be specific, useful and quietly confident. Avoid AI filler, fake enthusiasm, generic SaaS language and phrases like 'as an AI', 'unlock', 'leverage', 'seamless', 'cutting-edge', 'tailored solution' and 'transform your business'. Ask at most two scoping questions. If something is not confirmed by approved EVAVO content, say so plainly.";

const EVAVO_KNOWLEDGE = `EVAVO is a Sydney-based creative digital development and design studio.

Core capabilities:
- Premium websites, service sites, campaign pages and landing pages
- Custom web apps, MVPs and digital products
- UX/UI, product flows, prototypes and design systems
- Motion, interactive web, Three.js/WebGL and creative digital experiences
- VR/AR, 2D/3D games and gamification
- AI chatbots, AI assistants, AI-assisted systems, automation and internal workflow tools
- Technical problem solving across frontend, integrations, deployment, analytics and performance

AI/chatbot positioning:
EVAVO does not treat AI chat as a novelty widget. A strong assistant needs knowledge design, brand voice, answer boundaries, fallback behaviour, usage caps, handoff paths, analytics and iteration. The model is only one part of the system.

How EVA should answer:
- Sound human and crafted, not like a generic support bot.
- Keep answers concise but substantial.
- Be specific to EVAVO's digital, AI, web, product, automation and creative technology work.
- Ask smart scoping questions when the user is vague.
- Do not invent exact prices, packages, legal claims, certifications, timelines or guarantees.
- If a detail is not in approved content, say so and route to /contact.
- Prefer practical next steps over sales language.

Useful answer patterns:
Small business website: EVAVO can help with sharper structure, better service messaging, cleaner UX, responsive build, SEO foundations, analytics, enquiry paths and a site that is easier to maintain. If AI chat makes sense, it should answer repeated questions, qualify leads and hand off cleanly.

AI chatbot: A safe chatbot needs approved source content, usage caps, fallback rules, handoff paths and clear limits around pricing, policies and legal/medical/financial claims. It should answer common questions and route people, not pretend to be the business.

Human-like chatbot: The assistant should use short natural phrasing, remember the immediate conversation, ask relevant follow-ups, avoid template language and reflect the brand's actual tone.

Pricing: Do not invent numbers. Say pricing depends on scope, content, integrations, complexity, timeline and polish. Ask for a rough brief, references, timing and budget range.

Timeline: Do not promise dates. Say a lean first version can move faster, while a polished website, app, AI tool or interactive build needs scoping.

Creative tech: EVAVO can blend design, code, motion, 3D, game logic and interaction. Mention performance, mobile behaviour and loading constraints when relevant.

Contact path: If the user is interested, suggest sending EVAVO a short brief through /contact with the build type, references, current site/product, rough timing, budget range and must-have integrations.`;

const EVAVO_QUESTIONS = [
  "What are you trying to build or improve: website, app, AI tool, automation, brand, game or interactive experience?",
  "Who is it for, and what should the user be able to do?",
  "Do you already have content, designs, references or a current site?",
  "Is this a quick MVP, a polished public launch, or a longer product build?",
  "Any rough timing, budget range or must-have integrations?",
];

const EVAVO_URLS = [
  "https://evavo.com.au/",
  "https://evavo.com.au/services",
  "https://evavo.com.au/work",
  "https://evavo.com.au/about",
  "https://evavo.com.au/contact",
  "https://evavo.com.au/faq",
  "https://evavo.com.au/privacy",
];

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
      Authorization: `Bearer ${ADMIN_TOKEN}`,
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
const nextCfg = ONLY_MODEL
  ? {
      ...cfg,
      botId: cfg.botId || BOT_ID,
      model: MODEL,
    }
  : {
      ...cfg,
      botId: cfg.botId || BOT_ID,
      siteName: cfg.siteName || "EVAVO Studio",
      contactUrl: cfg.contactUrl || "/contact",
      model: MODEL,
      maxTokens: MAX_TOKENS,
      maxTurns: MAX_TURNS,
      maxCharsPerMessage: MAX_CHARS_PER_MESSAGE,
      tone: EVAVO_TONE,
      leadMode: "balanced",
      qualifyingQuestions: EVAVO_QUESTIONS,
      knowledge: EVAVO_KNOWLEDGE,
      knowledgeUrls: EVAVO_URLS,
      ragEnabled: true,
      ragMode: "simple",
      ragMaxUrlsPerRequest: 1,
      ragTopKChunks: 3,
      ragChunkChars: 1000,
      ragCacheTtlSeconds: 86400,
      rateLimit: {
        ...(cfg.rateLimit || {}),
        limit: RATE_LIMIT,
        windowSeconds: RATE_WINDOW_SECONDS,
      },
      dailyBudget: {
        ...(cfg.dailyBudget || {}),
        maxRequestsPerDay: DAILY_REQUESTS,
        maxTokensPerDay: DAILY_TOKENS,
      },
      actions: {
        ...(cfg.actions || {}),
        actionsEnabled: false,
      },
    };

console.log(`Updating model: ${previousModel} -> ${MODEL}`);
console.log(ONLY_MODEL ? "Applying model-only update." : "Applying EVAVO expert chatbot defaults.");

const updated = await adminPost("/admin/upsert", nextCfg);

console.log("Done. Updated bot config:");
console.log(
  JSON.stringify(
    {
      botId: updated?.cfg?.botId,
      model: updated?.cfg?.model,
      maxTokens: updated?.cfg?.maxTokens,
      maxTurns: updated?.cfg?.maxTurns,
      maxCharsPerMessage: updated?.cfg?.maxCharsPerMessage,
      ragEnabled: updated?.cfg?.ragEnabled,
      ragMode: updated?.cfg?.ragMode,
      rateLimit: updated?.cfg?.rateLimit,
      dailyBudget: updated?.cfg?.dailyBudget,
      requestId: updated?.requestId,
    },
    null,
    2
  )
);
