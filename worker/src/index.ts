// src/index.ts
// Cloudflare Workers (module worker) + KV + native Workers AI binding (env.AI)
// Routes:
//   GET  /health
//   POST /api/chat         (public, CORS-restricted by bot.allowedOrigins + localhost dev)
//   POST /admin/get        (auth)
//   POST /admin/upsert     (auth)
//
// Notes:
// - CORS is enforced per-bot on /api/chat. Health + root are permissive for convenience.
// - "raw" AI output is NOT returned unless debug=1 query param OR x-debug: 1 header.
// - Admin endpoints require Authorization: Bearer <ADMIN_TOKEN> (env.ADMIN_TOKEN).

type Role = "system" | "user" | "assistant";

type ChatMessage = {
  role: Role;
  content: string;
};

type BotConfig = {
  botId: string;
  siteName: string;
  contactUrl?: string;
  tone?: string;
  greeting?: string;
  brandHex?: string;
  model?: string;
  maxTokens?: number;
  leadMode?: "soft" | "balanced" | "hard";
  qualifyingQuestions?: string[];
  allowedOrigins?: string[];

  /** Extra domain-specific knowledge (FAQ / policies / boundaries). */
  knowledge?: string;

  /** URLs to pull reference text from (static HTML recommended). */
  knowledgeUrls?: string[];

  /** Enable lightweight retrieval from knowledgeUrls. */
  ragEnabled?: boolean;

  /** Max URLs fetched per chat request (capped). */
  ragMaxUrlsPerRequest?: number;
};

export interface Env {
  BOT_CONFIG: KVNamespace;
  AI: any; // native Workers AI binding
  ADMIN_TOKEN: string;
}

type RateLimit = {
  windowMs: number;
  max: number;
};

const DEFAULT_RATE_LIMIT: RateLimit = {
  windowMs: 60_000,
  max: 20,
};

const DEV_ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8787",
]);

async function sha1Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-1", enc);
  const b = new Uint8Array(buf);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function stripHtmlToText(html: string): string {
  return (
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(br|p|div|li|h\d)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[\t ]{2,}/g, " ")
      .trim()
  );
}

function clampText(s: string, max = 18_000) {
  const t = (s ?? "").toString();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

async function getCachedUrlText(env: Env, botId: string, url: string): Promise<string | null> {
  const key = `kb:url:${botId}:${await sha1Hex(url)}`;
  const cached = await env.BOT_CONFIG.get(key);
  if (cached) return cached;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "EVAVO Client Chat Platform (kb fetch)",
        "Accept": "text/html,application/xhtml+xml",
      },
      cf: {
        cacheTtl: 60 * 60,
        cacheEverything: true,
      } as any,
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = clampText(stripHtmlToText(html), 14_000);
    if (!text) return null;
    await env.BOT_CONFIG.put(key, text, { expirationTtl: 60 * 60 * 24 });
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function checkRateLimit(env: Env, request: Request, botId: string, rl: RateLimit = DEFAULT_RATE_LIMIT) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const bucket = Math.floor(Date.now() / rl.windowMs);
  const key = `rl:${botId}:${ip}:${bucket}`;
  const current = Number((await env.BOT_CONFIG.get(key)) || "0");
  if (current >= rl.max) return { allowed: false };
  await env.BOT_CONFIG.put(key, String(current + 1), {
    expirationTtl: Math.ceil(rl.windowMs / 1000) + 5,
  });
  return { allowed: true };
}

function kvKey(botId: string) {
  return `bot:${botId}`;
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  // no pretty-print in production if you want smaller responses:
  return new Response(JSON.stringify(data), { ...init, headers });
}

function corsHeaders(allowOrigin: string | null) {
  const h = new Headers();
  h.set("Vary", "Origin");
  if (allowOrigin) h.set("Access-Control-Allow-Origin", allowOrigin);
  h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  h.set("Access-Control-Allow-Headers", "content-type, authorization, x-debug");
  h.set("Access-Control-Max-Age", "86400");
  return h;
}

function withCors(resp: Response, allowOrigin: string | null) {
  const headers = new Headers(resp.headers);
  const ch = corsHeaders(allowOrigin);
  ch.forEach((v, k) => headers.set(k, v));
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

function isAuthorized(request: Request, env: Env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ")
    ? auth.slice("Bearer ".length).trim()
    : "";
  return Boolean(token) && token === env.ADMIN_TOKEN;
}

async function readJson<T>(request: Request): Promise<T> {
  const text = await request.text();
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(
      `Invalid JSON body: ${(e as Error).message}. Body starts: ${text.slice(
        0,
        200
      )}`
    );
  }
}

function normalizeOrigins(origins: unknown): string[] {
  if (!Array.isArray(origins)) return [];
  return origins
    .map((o) => (typeof o === "string" ? o.trim() : ""))
    .filter(Boolean);
}

function pickAllowedOrigin(requestOrigin: string | null, cfg: BotConfig | null) {
  if (!requestOrigin) return null;

  // If bot config exists, enforce its allowedOrigins + dev allowed
  const allowed = new Set([
    ...normalizeOrigins(cfg?.allowedOrigins),
    ...DEV_ALLOWED_ORIGINS,
  ]);

  return allowed.has(requestOrigin) ? requestOrigin : null;
}

function buildSystemPrompt(cfg: BotConfig) {
  const tone = cfg.tone ?? "helpful, concise, high-trust";
  const greeting = cfg.greeting ?? "Hi — how can I help today?";
  const leadMode = cfg.leadMode ?? "balanced";
  const qs = Array.isArray(cfg.qualifyingQuestions) ? cfg.qualifyingQuestions : [];
  const knowledge = (cfg.knowledge ?? "").trim();

  const leadInstruction =
    leadMode === "hard"
      ? "Actively qualify immediately. Ask 2–4 short questions early."
      : leadMode === "soft"
      ? "Be helpful first. Ask qualifying questions only after giving useful info."
      : "Balance helpful answers with gentle qualification questions.";

  return [
    `You are the website chat assistant for "${cfg.siteName}".`,
    `Tone: ${tone}.`,
    `Lead mode: ${leadMode}. ${leadInstruction}`,
    knowledge ? `Additional knowledge (use when relevant):\n${knowledge}` : "",
    `If the user wants contact/onboarding, direct them to: ${
      cfg.contactUrl ?? "the contact page"
    }.`,
    `Greeting: ${greeting}`,
    qs.length
      ? `Qualifying questions you may use (pick only what’s relevant): ${qs.join(
          " "
        )}`
      : "",
    `Rules:`,
    `- Be practical and calm.`,
    `- Keep answers short unless asked for detail.`,
    `- If you don't know pricing, say so and suggest next steps.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function extractText(result: any): string {
  if (!result) return "";
  if (typeof result === "string") return result;

  // Common Workers AI response shapes
  if (typeof result.response === "string") return result.response;
  if (typeof result.result === "string") return result.result;

  const choice = result?.choices?.[0]?.message?.content;
  if (typeof choice === "string") return choice;

  // fallback
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function sanitizeMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  const out: ChatMessage[] = [];

  for (const m of input) {
    if (!m || typeof m !== "object") continue;
    const role = (m as any).role;
    const content = (m as any).content;

    if (role !== "user" && role !== "assistant" && role !== "system") continue;
    if (typeof content !== "string") continue;

    const trimmed = content.trim();
    if (!trimmed) continue;

    // Optional: block client-sent system prompts (recommended)
    // We already add our own system prompt.
    if (role === "system") continue;

    // Safety: cap message length to avoid abuse
    out.push({ role, content: trimmed.slice(0, 8000) });
    if (out.length >= 50) break;
  }

  return out;
}

function wantDebug(request: Request, url: URL) {
  const q = url.searchParams.get("debug");
  if (q === "1" || q === "true") return true;
  const h = request.headers.get("x-debug");
  return h === "1" || h === "true";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const requestId = crypto.randomUUID();

    // OPTIONS preflight:
    // - For /api/chat we can’t know botId without body, so we respond with
    //   conservative CORS: allow origin only if it’s a known dev origin, otherwise echo nothing.
    //   Browsers will still succeed once real request gets allow-origin.
    if (request.method === "OPTIONS") {
      const allow =
        origin && DEV_ALLOWED_ORIGINS.has(origin) ? origin : null;
      return withCors(new Response(null, { status: 204 }), allow);
    }

    // Health (permissive)
    if (url.pathname === "/health" && request.method === "GET") {
      return withCors(
        json({ ok: true, requestId }),
        origin ?? null
      );
    }

    // Friendly 404 on root
    if (url.pathname === "/" && request.method === "GET") {
      return withCors(
        json(
          {
            ok: false,
            error: "Not found",
            requestId,
            routes: [
              "GET /health",
              "POST /api/chat",
              "POST /admin/get (auth)",
              "POST /admin/upsert (auth)",
            ],
          },
          { status: 404 }
        ),
        origin ?? null
      );
    }

    // ---------------- Admin (protected by ADMIN_TOKEN) ----------------

    if (url.pathname === "/admin/get" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return withCors(json({ ok: false, error: "Unauthorized", requestId }, { status: 401 }), origin ?? null);
      }

      const body = await readJson<{ botId?: string }>(request);
      const botId = (body.botId ?? "").trim();
      if (!botId) {
        return withCors(json({ ok: false, error: "botId required", requestId }, { status: 400 }), origin ?? null);
      }

      const raw = await env.BOT_CONFIG.get(kvKey(botId));
      const cfg = raw ? (JSON.parse(raw) as BotConfig) : null;

      return withCors(json({ ok: true, cfg, requestId }), origin ?? null);
    }

    if (url.pathname === "/admin/upsert" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return withCors(json({ ok: false, error: "Unauthorized", requestId }, { status: 401 }), origin ?? null);
      }

      // IMPORTANT: never let admin writes crash the worker.
      // A hard crash becomes Cloudflare's opaque "1101" error code.
      try {
        const cfg = await readJson<BotConfig>(request);
        const botId = (cfg.botId ?? "").trim();
        if (!botId) {
          return withCors(json({ ok: false, error: "botId required", requestId }, { status: 400 }), origin ?? null);
        }

        const stored: BotConfig = {
          botId,
          siteName: (cfg.siteName ?? "Site").trim(),
          contactUrl: cfg.contactUrl,
          tone: cfg.tone,
          greeting: cfg.greeting,
          brandHex: cfg.brandHex,
          model: cfg.model,
          maxTokens: cfg.maxTokens,
          leadMode: cfg.leadMode ?? "balanced",
          qualifyingQuestions: Array.isArray(cfg.qualifyingQuestions) ? cfg.qualifyingQuestions : [],
          allowedOrigins: Array.isArray(cfg.allowedOrigins) ? cfg.allowedOrigins : [],

          knowledge: typeof cfg.knowledge === "string" ? cfg.knowledge.slice(0, 40_000) : undefined,
          knowledgeUrls: Array.isArray(cfg.knowledgeUrls)
            ? cfg.knowledgeUrls
                .map((u) => (u ?? "").toString().trim())
                .filter(Boolean)
                .slice(0, 25)
            : [],
          ragEnabled: !!cfg.ragEnabled,
          ragMaxUrlsPerRequest: Number.isFinite(Number(cfg.ragMaxUrlsPerRequest))
            ? Math.min(Math.max(Number(cfg.ragMaxUrlsPerRequest), 1), 4)
            : 2,
        };

        await env.BOT_CONFIG.put(kvKey(botId), JSON.stringify(stored));
        return withCors(json({ ok: true, requestId }, { status: 200 }), origin ?? null);
      } catch (e) {
        console.error("/admin/upsert failed", e);
        const detail = (e as Error)?.message || "Unknown error";
        return withCors(
          json({ ok: false, error: "internal_error", detail, requestId }, { status: 500 }),
          origin ?? null
        );
      }
    }

    // Refresh cached knowledge URL text for a bot (useful after site changes)
    if (url.pathname === "/admin/kb/refresh" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return withCors(json({ ok: false, error: "Unauthorized", requestId }, { status: 401 }), origin ?? null);
      }

      const body = await readJson<{ botId?: string; urls?: string[] }>(request);
      const botId = (body.botId ?? "").trim();
      if (!botId) {
        return withCors(json({ ok: false, error: "botId required", requestId }, { status: 400 }), origin ?? null);
      }

      const raw = await env.BOT_CONFIG.get(kvKey(botId));
      if (!raw) {
        return withCors(json({ ok: false, error: "Unknown bot", requestId }, { status: 404 }), origin ?? null);
      }
      const cfg = JSON.parse(raw) as BotConfig;

      const urls = Array.isArray(body.urls) && body.urls.length
        ? body.urls.map((u) => (u ?? "").toString().trim()).filter(Boolean)
        : Array.isArray(cfg.knowledgeUrls)
        ? cfg.knowledgeUrls
        : [];

      const max = Math.min(urls.length, 10);
      const refreshed: { url: string; ok: boolean }[] = [];
      for (const u of urls.slice(0, max)) {
        const text = await getCachedUrlText(env, botId, u);
        refreshed.push({ url: u, ok: !!text });
      }

      return withCors(json({ ok: true, botId, refreshed, requestId }, { status: 200 }), origin ?? null);
    }

    // ---------------- Public chat (CORS restricted) ----------------

    if (url.pathname === "/api/chat" && request.method === "POST") {
      const debug = wantDebug(request, url);

      try {
        const body = await readJson<{ botId?: string; messages?: unknown }>(request);
        const botId = (body.botId ?? "").trim();

        if (!botId) {
          return withCors(
            json({ ok: false, error: "botId required", requestId }, { status: 400 }),
            origin ?? null
          );
        }

        const rawCfg = await env.BOT_CONFIG.get(kvKey(botId));
        if (!rawCfg) {
          return withCors(
            json({ ok: false, error: "unknown_bot", botId, requestId }, { status: 404 }),
            origin ?? null
          );
        }

        const cfg = JSON.parse(rawCfg) as BotConfig;

        // Cost protection: basic per-IP rate limit (KV-backed).
        const rl = await checkRateLimit(env, request, cfg.botId);
        if (!rl.allowed) {
          return withCors(
            json(
              {
                ok: false,
                error: "rate_limited",
                detail: "Too many requests. Please try again shortly.",
                requestId,
              },
              { status: 429 }
            ),
            origin ?? null
          );
        }

        const allowedOrigin = pickAllowedOrigin(origin, cfg);
        // If browser origin present and not allowed -> forbid
        if (origin && !allowedOrigin) {
          return withCors(
            json({ ok: false, error: "origin_not_allowed", origin, requestId }, { status: 403 }),
            null
          );
        }

        const messages = sanitizeMessages(body.messages);
        const system = buildSystemPrompt(cfg);

        // Lightweight retrieval: fetch a small list of static pages and include as context.
        // Note: JS-rendered pages may not work with plain fetch. For those, use an ingestion step.
        let retrievedContext = "";
        if (cfg.ragEnabled && Array.isArray(cfg.knowledgeUrls) && cfg.knowledgeUrls.length) {
          const maxUrls = Math.min(cfg.ragMaxUrlsPerRequest ?? 2, 4);
          const urls = cfg.knowledgeUrls.slice(0, maxUrls);
          const texts = await Promise.all(urls.map((u) => getCachedUrlText(env, cfg.botId, u)));
          const joined = texts.filter(Boolean).join("\n\n---\n\n");
          retrievedContext = clampText(joined, 18_000);
        }

        const fullMessages: any[] = [{ role: "system", content: system }];
        if (retrievedContext) {
          fullMessages.push({
            role: "system",
            content:
              "Context excerpts (cached from allowed URLs). Use as reference; if uncertain, ask a clarifying question.\n\n" +
              retrievedContext,
          });
        }
        fullMessages.push(...messages);

        // Native Workers AI call (env.AI binding)
        const result = await env.AI.run(cfg.model || "@cf/meta/llama-3-8b-instruct", {
          messages: fullMessages,
          max_tokens: Math.min(Math.max(Number(cfg.maxTokens ?? 512), 64), 2048),
        });

        const text = extractText(result);

        const payload: any = {
          ok: true,
          message: text,
          requestId,
        };

        if (debug) payload.raw = result;

        return withCors(json(payload), allowedOrigin);
      } catch (err) {
        console.error("CHAT_ERROR", { requestId, err: String(err) });
        return withCors(
          json(
            { ok: false, error: "chat_failed", detail: String(err), requestId },
            { status: 500 }
          ),
          origin ?? null
        );
      }
    }

    // fallback
    return withCors(
      json({ ok: false, error: "Not found", requestId }, { status: 404 }),
      origin ?? null
    );
  },
};
