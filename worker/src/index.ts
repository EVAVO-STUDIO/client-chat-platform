// worker/src/index.ts
/**
 * Client Chat Platform (Cloudflare Worker)
 * - Multi-tenant chatbot backend with optional RAG from allow-listed URLs
 * - Admin endpoints to configure each bot
 * - Optional "actions" (webhooks) to support interactive workflows (lead capture, handoff, etc.)
 *
 * Backward compatibility:
 * - /api/chat still returns { ok, message } and also includes { reply: message }
 */

export interface Env {
  BOT_CONFIG: KVNamespace;
  KB_CACHE: KVNamespace;
  AI: any; // Cloudflare AI binding
  ADMIN_TOKEN?: string; // set via `wrangler secret put ADMIN_TOKEN`
}

/** ===== Types ===== */

type Role = "user" | "assistant" | "system";

type ChatMessage = { role: Role; content: string };

type LeadMode = "soft" | "balanced" | "direct";

type ActionType = "open_contact" | "create_lead" | "webhook" | "none";

type BotActionConfig = {
  /** Enables structured actions/tooling. If off, model is instructed not to emit tool calls. */
  actionsEnabled?: boolean;

  /** Where to POST structured actions (e.g. CRM / Zapier / Make / custom API) */
  webhookUrl?: string;

  /** Optional static header, e.g. `Authorization: Bearer ...` */
  webhookAuthHeader?: string;

  /** Optional shared secret included as `x-chat-platform-signature` (HMAC-like simple token) */
  webhookSecret?: string;

  /** Allowed action types the model can request */
  allowedActionTypes?: ActionType[];
};

type RateLimitConfig = {
  /** Requests per window per IP+botId */
  limit?: number;
  /** Window seconds */
  windowSeconds?: number;
};

type BotConfig = {
  botId: string;
  siteName?: string;
  contactUrl?: string;

  tone?: string;

  model?: string;
  maxTokens?: number;

  allowedOrigins?: string[];

  /** Lead gen behavior */
  leadMode?: LeadMode;
  qualifyingQuestions?: string[];

  /** Plain, short, static knowledge (small) */
  knowledge?: string;

  /** Allow-list URLs for RAG */
  knowledgeUrls?: string[];
  ragEnabled?: boolean;
  ragMode?: "simple" | "embed";
  ragMaxUrlsPerRequest?: number;
  ragTopKChunks?: number;
  ragChunkChars?: number;
  ragCacheTtlSeconds?: number;
  ragEmbeddingModel?: string;

  /** Guardrails */
  maxTurns?: number; // max messages in a request (after trimming)
  maxCharsPerMessage?: number;

  /** Per-bot rate limit override */
  rateLimit?: RateLimitConfig;

  /** Optional automation/actions support */
  actions?: BotActionConfig;

  /** Schema version for future migrations */
  schemaVersion?: number;
};

type ChatOk = {
  ok: true;
  message: string;
  /** Back-compat alias for older widget */
  reply: string;
  raw?: unknown;
  action?: {
    type: ActionType;
    /** For open_contact */
    contactUrl?: string;
    /** Arbitrary payload for integrations */
    payload?: any;
  };
  requestId: string;
};

type ChatErr = {
  ok: false;
  error: string;
  detail?: string;
  requestId: string;
};

/** ===== Utilities ===== */

function uid() {
  // requestId only (not crypto-critical)
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function json(status: number, body: Record<string, unknown>, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(extraHeaders ?? {}),
    },
  });
}

function getHeader(req: Request, name: string) {
  const v = req.headers.get(name);
  return typeof v === "string" ? v : "";
}

function getRequestOrigin(req: Request) {
  const o = getHeader(req, "origin");
  if (o) return o;

  const proto =
    getHeader(req, "x-forwarded-proto") ||
    getHeader(req, "x-forwarded-protocol") ||
    "https";
  const host = getHeader(req, "x-forwarded-host") || getHeader(req, "host");
  if (host) return `${proto}://${host}`;

  return "";
}

function parseBearerToken(req: Request) {
  const h = getHeader(req, "authorization");
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1]?.trim() || "";
}

function sanitizeUrlList(urls: unknown, max = 50) {
  if (!Array.isArray(urls)) return [];
  const out: string[] = [];
  for (const u of urls) {
    if (typeof u !== "string") continue;
    const s = u.trim();
    if (!s) continue;
    try {
      const parsed = new URL(s);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      out.push(parsed.toString());
      if (out.length >= max) break;
    } catch {
      // ignore
    }
  }
  return out;
}

function sanitizeOrigins(origins: unknown, max = 25) {
  if (!Array.isArray(origins)) return [];
  const out: string[] = [];
  for (const o of origins) {
    if (typeof o !== "string") continue;
    const s = o.trim();
    if (!s) continue;
    try {
      const u = new URL(s);
      // Normalize to origin only
      out.push(u.origin);
      if (out.length >= max) break;
    } catch {
      // ignore
    }
  }
  return Array.from(new Set(out));
}

function isOriginAllowed(origin: string, allowedOrigins: string[] | undefined) {
  if (!origin) return false;
  if (!allowedOrigins || !allowedOrigins.length) return true; // permissive default if not configured
  try {
    const o = new URL(origin).origin;
    return allowedOrigins.includes(o);
  } catch {
    return false;
  }
}

function clampInt(n: unknown, def: number, min: number, max: number) {
  const x = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  if (!Number.isFinite(x)) return def;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function normalizeActionConfig(v: any): BotActionConfig | undefined {
  if (!v || typeof v !== "object") return undefined;

  const allowed = Array.isArray(v.allowedActionTypes)
    ? (v.allowedActionTypes.filter((t: any) => t === "open_contact" || t === "create_lead" || t === "webhook" || t === "none") as ActionType[])
    : undefined;

  const webhookUrl = typeof v.webhookUrl === "string" ? v.webhookUrl.trim() : "";
  const webhookAuthHeader = typeof v.webhookAuthHeader === "string" ? v.webhookAuthHeader.trim() : "";
  const webhookSecret = typeof v.webhookSecret === "string" ? v.webhookSecret.trim() : "";

  let parsedWebhook = "";
  try {
    if (webhookUrl) parsedWebhook = new URL(webhookUrl).toString();
  } catch {
    parsedWebhook = "";
  }

  return {
    actionsEnabled: !!v.actionsEnabled,
    webhookUrl: parsedWebhook || undefined,
    webhookAuthHeader: webhookAuthHeader || undefined,
    webhookSecret: webhookSecret || undefined,
    allowedActionTypes: allowed && allowed.length ? allowed : undefined,
  };
}

function normalizeConfig(incoming: any, existing?: BotConfig): BotConfig {
  const botId = typeof incoming?.botId === "string" ? incoming.botId.trim() : "";
  if (!botId) throw new Error("Missing botId");

  const cfg: BotConfig = {
    botId,
    schemaVersion: 2,
    siteName: typeof incoming?.siteName === "string" ? incoming.siteName.trim() : existing?.siteName,
    contactUrl: typeof incoming?.contactUrl === "string" ? incoming.contactUrl.trim() : existing?.contactUrl,
    tone: typeof incoming?.tone === "string" ? incoming.tone.trim() : existing?.tone,

    model: typeof incoming?.model === "string" ? incoming.model.trim() : existing?.model,
    maxTokens: clampInt(incoming?.maxTokens, existing?.maxTokens ?? 512, 64, 2048),

    allowedOrigins: sanitizeOrigins(incoming?.allowedOrigins ?? existing?.allowedOrigins),

    leadMode: (incoming?.leadMode === "soft" || incoming?.leadMode === "balanced" || incoming?.leadMode === "direct")
      ? incoming.leadMode
      : (existing?.leadMode ?? "balanced"),
    qualifyingQuestions: Array.isArray(incoming?.qualifyingQuestions)
      ? incoming.qualifyingQuestions.filter((x: any) => typeof x === "string").map((s: string) => s.trim()).filter(Boolean).slice(0, 6)
      : existing?.qualifyingQuestions,

    knowledge: typeof incoming?.knowledge === "string" ? incoming.knowledge : existing?.knowledge,

    knowledgeUrls: sanitizeUrlList(incoming?.knowledgeUrls ?? existing?.knowledgeUrls),
    ragEnabled: typeof incoming?.ragEnabled === "boolean" ? incoming.ragEnabled : (existing?.ragEnabled ?? false),
    ragMaxUrlsPerRequest: clampInt(incoming?.ragMaxUrlsPerRequest, existing?.ragMaxUrlsPerRequest ?? 2, 0, 10),

    maxTurns: clampInt(incoming?.maxTurns, existing?.maxTurns ?? 20, 4, 40),
    maxCharsPerMessage: clampInt(incoming?.maxCharsPerMessage, existing?.maxCharsPerMessage ?? 4000, 200, 12000),

    rateLimit: {
      limit: clampInt(incoming?.rateLimit?.limit, existing?.rateLimit?.limit ?? 12, 1, 120),
      windowSeconds: clampInt(incoming?.rateLimit?.windowSeconds, existing?.rateLimit?.windowSeconds ?? 60, 10, 3600),
    },

    actions: normalizeActionConfig(incoming?.actions ?? existing?.actions),
  };

  // Reasonable defaults
  if (!cfg.contactUrl) cfg.contactUrl = "/contact";
  if (!cfg.siteName) cfg.siteName = cfg.botId;

  return cfg;
}

function stripHtmlToText(html: string) {
  // A simple, low-risk stripper (not a full parser)
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** ===== Rate limiting ===== */

function ipFromReq(req: Request) {
  // Cloudflare header
  const ip = getHeader(req, "cf-connecting-ip") || getHeader(req, "x-forwarded-for");
  return (ip || "").split(",")[0].trim() || "unknown";
}

async function checkRateLimit(env: Env, botId: string, req: Request, cfg?: BotConfig) {
  const rl = cfg?.rateLimit;
  const limit = rl?.limit ?? 12;
  const windowSeconds = rl?.windowSeconds ?? 60;

  const ip = ipFromReq(req);
  const key = `rl:${botId}:${ip}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
  const current = Number((await env.KB_CACHE.get(key)) || "0") || 0;

  if (current >= limit) return { ok: false as const, limit, windowSeconds };

  // KV has no atomic increment, but this is "good enough" for lightweight abuse control.
  await env.KB_CACHE.put(key, String(current + 1), { expirationTtl: windowSeconds + 5 });
  return { ok: true as const, limit, windowSeconds };
}

/** ===== Knowledge / RAG ===== */

async function getCachedUrlText(env: Env, url: string, ttlSeconds = 60 * 60, force = false) {
  const cacheKey = `kb:${url}`;
  if (!force) {
    const cached = await env.KB_CACHE.get(cacheKey);
    if (cached) return cached;
  }

  const res = await fetch(url, {
    method: "GET",
    headers: { "User-Agent": "EVAVO-ChatPlatform/1.0 (+https://evavo-studio.com)" },
  });

  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  const ct = res.headers.get("content-type") || "";
  const raw = await res.text();

  const text = ct.includes("text/html") ? stripHtmlToText(raw) : raw.slice(0, 200_000);
  const clipped = text.slice(0, 60_000);

  await env.KB_CACHE.put(cacheKey, clipped, { expirationTtl: ttlSeconds });
  return clipped;
}

function selectRelevantUrls(question: string, urls: string[], max: number) {
  if (!urls.length || max <= 0) return [];
  const q = (question || "").toLowerCase();
  const scored = urls.map((u) => {
    const p = u.toLowerCase();
    let score = 0;
    // Heuristics: matching path terms gives a boost
    for (const term of q.split(/\W+/g).filter(Boolean).slice(0, 20)) {
      if (term.length < 3) continue;
      if (p.includes(term)) score += 2;
    }
    // Common boosts
    if (q.includes("price") || q.includes("pricing") || q.includes("cost")) if (p.includes("pricing")) score += 5;
    if (q.includes("contact") || q.includes("quote")) if (p.includes("contact")) score += 5;
    if (q.includes("privacy")) if (p.includes("privacy")) score += 5;
    if (q.includes("terms")) if (p.includes("terms")) score += 5;
    return { u, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.u);
}

// ===== RAG (simple vs embed) =====

function chunkText(text: string, chunkChars: number) {
  const t = (text || "").trim();
  if (!t) return [];
  const size = Math.max(200, Math.min(5000, chunkChars || 1200));
  const chunks: string[] = [];
  for (let i = 0; i < t.length; i += size) {
    const part = t.slice(i, i + size).trim();
    if (part.length >= 50) chunks.push(part);
  }
  return chunks.slice(0, 120);
}

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function cosineSim(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embedText(env: Env, model: string, text: string): Promise<number[] | null> {
  try {
    // Cloudflare AI embeddings commonly accept { text } or { texts: [...] } depending on model.
    const anyAI: any = env.AI as any;
    const res1 = await anyAI.run(model, { text });
    const vec = (res1 && (res1.data || res1.embedding || res1.vector || res1[0])) as any;
    if (Array.isArray(vec) && vec.length) return vec.map((n: any) => Number(n));
  } catch {}

  try {
    const anyAI: any = env.AI as any;
    const res2 = await anyAI.run(model, { texts: [text] });
    const vec = (res2 && (res2.data?.[0] || res2.embeddings?.[0] || res2[0])) as any;
    if (Array.isArray(vec) && vec.length) return vec.map((n: any) => Number(n));
  } catch {}

  return null;
}

async function getCachedEmbedding(env: Env, model: string, text: string, ttlSeconds: number) {
  const hash = await sha256Hex(`${model}::${text}`);
  const key = `emb:${hash}`;
  const cached = await env.KB_CACHE.get(key);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length) return parsed as number[];
    } catch {}
  }

  const vec = await embedText(env, model, text);
  if (!vec) return null;
  try {
    await env.KB_CACHE.put(key, JSON.stringify(vec), { expirationTtl: ttlSeconds });
  } catch {}
  return vec;
}

async function buildRagBlock(env: Env, cfg: BotConfig, question: string) {
  const urls = Array.isArray(cfg.knowledgeUrls) ? cfg.knowledgeUrls.filter(Boolean) : [];
  if (!cfg.ragEnabled || !urls.length) return "";

  const maxUrls = Math.max(1, Math.min(5, Number(cfg.ragMaxUrlsPerRequest ?? 2)));
  const ttl = Math.max(60, Math.min(7 * 86400, Number(cfg.ragCacheTtlSeconds ?? 86400)));
  const mode = (cfg.ragMode || "simple") as any;

  const chosen = selectRelevantUrls(question, urls, maxUrls);
  if (!chosen.length) return "";

  // Fetch text (cached)
  const texts: Array<{ url: string; text: string }> = [];
  for (const u of chosen) {
    try {
      const t = await getCachedUrlText(env, u, ttl);
      if (t) texts.push({ url: u, text: t });
    } catch {}
  }
  if (!texts.length) return "";

  if (mode !== "embed") {
    // Simple: include the top pages as context blobs
    const blocks = texts
      .map(({ url, text }) => `SOURCE: ${url}\n${text.slice(0, 2800)}`)
      .join("\n\n---\n\n");
    return `\n\nUse these sources as context (quote/paraphrase carefully; do not claim facts not in them):\n\n${blocks}`;
  }

  // Embed mode: chunk → embed → topK
  const embedModel = (cfg.ragEmbeddingModel || "@cf/baai/bge-base-en-v1.5").trim();
  const topK = Math.max(1, Math.min(10, Number(cfg.ragTopKChunks ?? 4)));
  const chunkChars = Math.max(300, Math.min(5000, Number(cfg.ragChunkChars ?? 1200)));

  const qVec = await getCachedEmbedding(env, embedModel, question.slice(0, 2000), ttl);
  if (!qVec) {
    // Fallback if embeddings unavailable
    const blocks = texts
      .map(({ url, text }) => `SOURCE: ${url}\n${text.slice(0, 2800)}`)
      .join("\n\n---\n\n");
    return `\n\nUse these sources as context (embeddings unavailable; fallback):\n\n${blocks}`;
  }

  const scoredChunks: Array<{ url: string; chunk: string; score: number }> = [];
  for (const { url, text } of texts) {
    for (const chunk of chunkText(text, chunkChars)) {
      const cVec = await getCachedEmbedding(env, embedModel, chunk, ttl);
      if (!cVec) continue;
      const score = cosineSim(qVec, cVec);
      scoredChunks.push({ url, chunk, score });
    }
  }

  scoredChunks.sort((a, b) => b.score - a.score);
  const picked = scoredChunks.slice(0, topK);
  if (!picked.length) return "";

  const blocks = picked
    .map((p) => `SOURCE: ${p.url}\nRELEVANCE: ${p.score.toFixed(3)}\n${p.chunk}`)
    .join("\n\n---\n\n");

  return `\n\nUse these sources as context (ranked excerpts; cite as “per site info” not as a quote):\n\n${blocks}`;
}

/** ===== Prompting / Actions ===== */

function buildSystemPrompt(cfg: BotConfig) {
  const tone = cfg.tone?.trim() || "calm, concise, high-trust";
  const leadMode = cfg.leadMode || "balanced";

  const qq = Array.isArray(cfg.qualifyingQuestions) ? cfg.qualifyingQuestions.filter(Boolean) : [];
  const qBlock =
    qq.length > 0
      ? `Qualifying questions you may ask (only when needed, 1–2 at a time):\n- ${qq.join("\n- ")}\n`
      : "";

  const actions = cfg.actions?.actionsEnabled ? true : false;
  const allowedActions = cfg.actions?.allowedActionTypes?.length
    ? cfg.actions.allowedActionTypes
    : (actions ? (["open_contact", "create_lead", "webhook", "none"] as ActionType[]) : (["none"] as ActionType[]));

  const actionBlock = actions
    ? `\nActions:\nYou may optionally return a JSON object instead of plain text.\nAllowed action types: ${allowedActions.join(", ")}.\nJSON format:\n{\n  "message": "string (human reply)",\n  "action": {\n    "type": "open_contact|create_lead|webhook|none",\n    "payload": { /* minimal structured data */ }\n  }\n}\nRules:\n- Prefer plain text unless an action will materially help.\n- Never invent phone numbers, emails, prices, or SLAs.\n- For "open_contact", keep payload as { "summary": "...", "email": "", "name": "" } when available.\n- For "create_lead" or "webhook", include only user-provided details.\n`
    : `\nActions:\nDo NOT output JSON. Only output normal text.\n`;

  const leadStyle =
    leadMode === "soft"
      ? "Be helpful first; only mention contacting sales when the user asks."
      : leadMode === "direct"
        ? "Guide toward a quote once you have minimal scoping info; politely ask qualifying questions."
        : "Answer and educate, then offer a quote/next step if relevant.";

  return [
    `You are the website assistant for "${cfg.siteName || cfg.botId}".`,
    `Tone: ${tone}.`,
    `Behavior: ${leadStyle}`,
    `Be truthful, avoid assumptions, be brief, and use bullet points when helpful.`,
    `When unsure, say what you do know and suggest the best next question.`,
    qBlock,
    actionBlock,
  ]
    .filter(Boolean)
    .join("\n");
}

function extractActionFromModelOutput(rawText: string): { message: string; action?: { type: ActionType; payload?: any } } {
  const trimmed = (rawText || "").trim();

  // Try JSON only if it looks like JSON
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const parsed = safeJsonParse(trimmed);
    if (parsed && typeof parsed === "object") {
      const msg = typeof (parsed as any).message === "string" ? (parsed as any).message : "";
      const action = (parsed as any).action;
      if (action && typeof action === "object") {
        const type = (action as any).type as ActionType;
        const allowed = type === "open_contact" || type === "create_lead" || type === "webhook" || type === "none";
        if (allowed) return { message: msg || "", action: { type, payload: (action as any).payload } };
      }
      if (msg) return { message: msg };
    }
  }

  return { message: trimmed };
}

async function maybeFireWebhook(env: Env, cfg: BotConfig, action: { type: ActionType; payload?: any }, requestId: string) {
  const a = cfg.actions;
  if (!a?.actionsEnabled) return;
  if (!a.webhookUrl) return;
  if (action.type !== "create_lead" && action.type !== "webhook") return;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-chat-platform-botid": cfg.botId,
    "x-chat-platform-requestid": requestId,
  };
  if (a.webhookAuthHeader) {
    const idx = a.webhookAuthHeader.indexOf(":");
    if (idx > 0) {
      headers[a.webhookAuthHeader.slice(0, idx).trim()] = a.webhookAuthHeader.slice(idx + 1).trim();
    } else {
      headers["Authorization"] = a.webhookAuthHeader;
    }
  }
  if (a.webhookSecret) headers["x-chat-platform-signature"] = a.webhookSecret;

  try {
    await fetch(a.webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        botId: cfg.botId,
        siteName: cfg.siteName,
        action,
        ts: Date.now(),
      }),
    });
  } catch {
    // Never fail chat due to webhook issues.
  }
}

/** ===== Handlers ===== */

async function requireAdmin(req: Request, env: Env) {
  const token = parseBearerToken(req);
  const expected = (env.ADMIN_TOKEN || "").trim();
  if (!expected) throw new Error("ADMIN_TOKEN is not set in worker secrets.");
  if (!token || token !== expected) throw new Error("UNAUTHORIZED");
}

async function handleAdminUpsert(req: Request, env: Env, requestId: string) {
  await requireAdmin(req, env);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return json(400, { ok: false, error: "BAD_REQUEST", detail: "Expected JSON object.", requestId });
  }

  const botId = typeof (body as any).botId === "string" ? (body as any).botId.trim() : "";
  if (!botId) return json(400, { ok: false, error: "BAD_REQUEST", detail: "Missing botId.", requestId });

  const existingRaw = await env.BOT_CONFIG.get(`cfg:${botId}`);
  const existing = existingRaw ? (safeJsonParse(existingRaw) as BotConfig) : undefined;

  let cfg: BotConfig;
  try {
    cfg = normalizeConfig(body, existing);
  } catch (e: any) {
    return json(400, { ok: false, error: "BAD_REQUEST", detail: e?.message || "Invalid config.", requestId });
  }

  await env.BOT_CONFIG.put(`cfg:${botId}`, JSON.stringify(cfg));

  return json(200, { ok: true, cfg, requestId }, requestId ? { "x-request-id": requestId } : undefined);
}

async function handleAdminGet(req: Request, env: Env, requestId: string) {
  await requireAdmin(req, env);

  const body = await req.json().catch(() => null);
  const botId = typeof body?.botId === "string" ? body.botId.trim() : "";
  if (!botId) return json(400, { ok: false, error: "BAD_REQUEST", detail: "Missing botId.", requestId });

  const raw = await env.BOT_CONFIG.get(`cfg:${botId}`);
  if (!raw) return json(404, { ok: false, error: "NOT_FOUND", detail: "Bot config not found.", requestId });

  return json(200, { ok: true, cfg: safeJsonParse(raw), requestId });
}

async function handleAdminList(req: Request, env: Env, requestId: string) {
  await requireAdmin(req, env);

  // KV does not support list by prefix in Workers KV in all plans via runtime binding.
  // We store a separate index of bot ids.
  const raw = await env.BOT_CONFIG.get("cfg:index");
  const ids = Array.isArray(safeJsonParse(raw || "[]")) ? (safeJsonParse(raw || "[]") as string[]) : [];
  return json(200, { ok: true, botIds: ids, requestId });
}

async function recordBotId(env: Env, botId: string) {
  const raw = await env.BOT_CONFIG.get("cfg:index");
  const parsed = safeJsonParse(raw || "[]");
  const ids = Array.isArray(parsed) ? (parsed as string[]) : [];
  if (!ids.includes(botId)) {
    ids.push(botId);
    await env.BOT_CONFIG.put("cfg:index", JSON.stringify(ids.slice(-200)));
  }
}

async function handleKbRefresh(req: Request, env: Env, requestId: string) {
  await requireAdmin(req, env);
  const body = await req.json().catch(() => null);
  const botId = typeof body?.botId === "string" ? body.botId.trim() : "";
  if (!botId) return json(400, { ok: false, error: "BAD_REQUEST", detail: "Missing botId.", requestId });

  const raw = await env.BOT_CONFIG.get(`cfg:${botId}`);
  if (!raw) return json(404, { ok: false, error: "NOT_FOUND", detail: "Bot config not found.", requestId });

  const cfg = safeJsonParse(raw) as BotConfig;
  const urls = sanitizeUrlList(cfg?.knowledgeUrls);
  if (!urls.length) return json(200, { ok: true, refreshed: 0, requestId });

  let refreshed = 0;
  for (const u of urls.slice(0, 30)) {
    try {
      await getCachedUrlText(env, u, 60 * 60, true);
      refreshed++;
    } catch {
      // ignore failures
    }
  }
  return json(200, { ok: true, refreshed, requestId });
}

async function handleChat(req: Request, env: Env, requestId: string) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    const out: ChatErr = { ok: false, error: "BAD_REQUEST", detail: "Expected JSON.", requestId };
    return json(400, out);
  }

  const botId = typeof (body as any).botId === "string" ? (body as any).botId.trim() : "";
  const messages = Array.isArray((body as any).messages) ? ((body as any).messages as any[]) : [];
  if (!botId || !messages.length) {
    const out: ChatErr = { ok: false, error: "BAD_REQUEST", detail: "Expected { botId, messages[] }.", requestId };
    return json(400, out);
  }

  const rawCfg = await env.BOT_CONFIG.get(`cfg:${botId}`);
  if (!rawCfg) {
    const out: ChatErr = { ok: false, error: "NOT_FOUND", detail: "Unknown botId.", requestId };
    return json(404, out);
  }
  const cfg = safeJsonParse(rawCfg) as BotConfig;

  // CORS/Origin checks
  const origin = getRequestOrigin(req);
  if (origin && !isOriginAllowed(origin, cfg.allowedOrigins)) {
    const out: ChatErr = { ok: false, error: "FORBIDDEN_ORIGIN", detail: "Origin not allowed.", requestId };
    return json(403, out, {
      "Access-Control-Allow-Origin": "null",
      "Vary": "Origin",
    });
  }

  // Lightweight per-IP rate limiting
  const rl = await checkRateLimit(env, botId, req, cfg);
  if (!rl.ok) {
    const out: ChatErr = {
      ok: false,
      error: "RATE_LIMITED",
      detail: `Too many requests. Limit ${rl.limit}/${rl.windowSeconds}s.`,
      requestId,
    };
    return json(429, out, {
      ...(origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}),
      "Retry-After": String(rl.windowSeconds),
    });
  }

  const maxTurns = cfg.maxTurns ?? 20;
  const maxChars = cfg.maxCharsPerMessage ?? 4000;

  const trimmed: ChatMessage[] = [];
  for (const m of messages.slice(-maxTurns)) {
    if (!m || typeof m !== "object") continue;
    const role = (m as any).role;
    if (role !== "user" && role !== "assistant") continue;
    const content = String((m as any).content ?? "").slice(0, maxChars);
    if (!content) continue;
    trimmed.push({ role, content });
  }

  if (!trimmed.length) {
    const out: ChatErr = { ok: false, error: "BAD_REQUEST", detail: "No valid messages.", requestId };
    return json(400, out);
  }

  const systemPrompt = buildSystemPrompt(cfg);

  // RAG: Select a small set of allow-listed URLs based on last user message
  let ragBlock = "";
  if (cfg.ragEnabled && cfg.knowledgeUrls?.length) {
    const lastUser = [...trimmed].reverse().find((m) => m.role === "user")?.content || "";
    const maxUrls = cfg.ragMaxUrlsPerRequest ?? 2;
    const chosen = selectRelevantUrls(lastUser, cfg.knowledgeUrls, maxUrls);

    if (chosen.length) {
      const chunks: string[] = [];
      for (const u of chosen) {
        try {
          const txt = await getCachedUrlText(env, u, 60 * 60);
          chunks.push(`SOURCE: ${u}\n${txt}`);
        } catch {
          // ignore failures
        }
      }
      if (chunks.length) {
        ragBlock =
          `\nYou may use the following website sources. Cite by URL if relevant.\n` +
          chunks.map((c) => `---\n${c}\n`).join("\n");
      }
    }
  }

  const knowledge = typeof cfg.knowledge === "string" && cfg.knowledge.trim() ? `\nWebsite notes:\n${cfg.knowledge.trim()}\n` : "";

  const input: ChatMessage[] = [
    { role: "system", content: systemPrompt + knowledge + ragBlock },
    ...trimmed,
  ];

  // Model defaults
  const model = cfg.model?.trim() || "@cf/meta/llama-3-8b-instruct";
  const maxTokens = cfg.maxTokens ?? 512;

  // Call Cloudflare AI
  let aiResult: any;
  try {
    aiResult = await env.AI.run(model, {
      messages: input.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: maxTokens,
    });
  } catch (e: any) {
    const out: ChatErr = { ok: false, error: "AI_ERROR", detail: e?.message || "AI call failed.", requestId };
    return json(502, out, {
      ...(origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}),
    });
  }

  const rawText =
    (aiResult?.response && typeof aiResult.response === "string" ? aiResult.response : "") ||
    (aiResult?.result?.response && typeof aiResult.result.response === "string" ? aiResult.result.response : "") ||
    "";

  const { message, action } = extractActionFromModelOutput(rawText);
  const safeMessage = (message || "").trim() || "Sorry — I couldn’t generate a response.";

  // Fire webhooks if configured and requested
  if (action?.type) await maybeFireWebhook(env, cfg, action, requestId);

  const out: ChatOk = {
    ok: true,
    message: safeMessage,
    reply: safeMessage,
    raw: aiResult,
    action: action
      ? {
          type: action.type,
          contactUrl: action.type === "open_contact" ? (cfg.contactUrl || "/contact") : undefined,
          payload: action.payload,
        }
      : undefined,
    requestId,
  };

  return json(200, out, {
    ...(origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}),
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "x-request-id": requestId,
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const requestId = uid();
    const url = new URL(req.url);

    // Preflight
    if (req.method === "OPTIONS") {
      const origin = getRequestOrigin(req);
      return new Response(null, {
        status: 204,
        headers: {
          "Cache-Control": "no-store",
          ...(origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}),
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
      });
    }

    // Routing
    try {
      if (url.pathname === "/admin/upsert" && req.method === "POST") {
        const res = await handleAdminUpsert(req, env, requestId);
        // record bot id for list
        try {
          const body = await req.clone().json().catch(() => null);
          const botId = typeof body?.botId === "string" ? body.botId.trim() : "";
          if (botId) await recordBotId(env, botId);
        } catch {}
        return res;
      }

      if (url.pathname === "/admin/get" && req.method === "POST") return await handleAdminGet(req, env, requestId);
      if (url.pathname === "/admin/list" && req.method === "POST") return await handleAdminList(req, env, requestId);
      if (url.pathname === "/admin/kb/refresh" && req.method === "POST") return await handleKbRefresh(req, env, requestId);

      if (url.pathname === "/api/chat" && req.method === "POST") return await handleChat(req, env, requestId);

      if (url.pathname === "/health") return json(200, { ok: true, requestId });

      return json(404, { ok: false, error: "NOT_FOUND", detail: "No such route.", requestId });
    } catch (e: any) {
      const msg = e?.message || "SERVER_ERROR";
      const status = msg === "UNAUTHORIZED" ? 401 : 500;
      return json(status, { ok: false, error: msg === "UNAUTHORIZED" ? "UNAUTHORIZED" : "SERVER_ERROR", detail: msg, requestId });
    }
  },
};
