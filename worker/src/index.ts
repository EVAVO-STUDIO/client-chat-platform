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
  leadMode?: "soft" | "balanced" | "hard";
  qualifyingQuestions?: string[];
  allowedOrigins?: string[];
};

export interface Env {
  BOT_CONFIG: KVNamespace;
  AI: any; // native Workers AI binding
  ADMIN_TOKEN: string;
}

const DEV_ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8787",
]);

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
        leadMode: cfg.leadMode ?? "balanced",
        qualifyingQuestions: Array.isArray(cfg.qualifyingQuestions) ? cfg.qualifyingQuestions : [],
        allowedOrigins: Array.isArray(cfg.allowedOrigins) ? cfg.allowedOrigins : [],
      };

      await env.BOT_CONFIG.put(kvKey(botId), JSON.stringify(stored));
      return withCors(json({ ok: true, requestId }), origin ?? null);
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

        // Native Workers AI call (env.AI binding)
        const result = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [{ role: "system", content: system }, ...messages],
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
