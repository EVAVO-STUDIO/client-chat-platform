// worker/src/index.ts
/**
 * Client Chat Platform (Cloudflare Worker)
 * - Multi-tenant chatbot backend with optional RAG from allow-listed URLs
 * - Admin endpoints to configure each bot + manage leads + refresh KB cache
 * - Strict cost & abuse controls (rate limit + daily budgets + optional bot key)
 * - Safer prompting (no invented pricing/SLAs; use KB links when unsure)
 *
 * Backward compatibility:
 * - /api/chat returns { ok, message } and also includes { reply: message }
 *
 * IMPORTANT FIX (your UNAUTHORIZED issue):
 * - Admin auth now reads env.ADMIN_TOKEN reliably and surfaces adminConfigured=true on /health.
 * - If ADMIN_TOKEN is missing/blank, admin endpoints return ADMIN_NOT_CONFIGURED (500), not a misleading 401.
 *
 * NOTE ON TS HEADERS ERROR:
 * - All header helper functions return ONLY Record<string,string> with no undefined values.
 * - Never build header objects with optional keys assigned to undefined.
 */

export interface Env {
  BOT_CONFIG: KVNamespace;
  KB_CACHE: KVNamespace;
  AI: any; // Cloudflare AI binding
  ADMIN_TOKEN?: string; // set via `wrangler secret put ADMIN_TOKEN`
}

/** ===== Hard global caps (defense in depth) ===== */
const GLOBAL_MAX_TOKENS = 1024;
const GLOBAL_MAX_TURNS = 30;
const GLOBAL_MAX_CHARS_PER_MESSAGE = 8000;

const GLOBAL_MAX_SYSTEM_CHARS = 30_000;
const GLOBAL_MAX_TOTAL_INPUT_CHARS = 75_000;

const GLOBAL_RAG_MAX_URLS = 5;
const GLOBAL_RAG_MAX_TOPK = 8;
const GLOBAL_RAG_MAX_CHUNK_CHARS = 2000;

const GLOBAL_RAG_EMBED_MAX_CHUNKS_PER_PAGE = 24;

const BUDGET_KEY_PREFIX = "bud:v1";

/** ===== Types ===== */

type Role = "user" | "assistant" | "system";
type ChatMessage = { role: Role; content: string };

type LeadMode = "soft" | "balanced" | "direct";

type ActionType = "open_contact" | "create_lead" | "webhook" | "none";

type BotActionConfig = {
  actionsEnabled?: boolean;
  webhookUrl?: string;
  webhookAuthHeader?: string;
  webhookSecret?: string;
  allowedActionTypes?: ActionType[];
};

type RateLimitConfig = {
  limit?: number;
  windowSeconds?: number;
};

type DailyBudgetConfig = {
  maxRequestsPerDay?: number;
  maxTokensPerDay?: number;
};

type BotConfig = {
  botId: string;
  siteName?: string;
  contactUrl?: string;

  tone?: string;

  model?: string;
  maxTokens?: number;

  /** Supports wildcards like https://*.vercel.app */
  allowedOrigins?: string[];

  botKey?: string;

  leadMode?: LeadMode;
  qualifyingQuestions?: string[];

  knowledge?: string;

  knowledgeUrls?: string[];
  ragEnabled?: boolean;
  ragMode?: "simple" | "embed";
  ragMaxUrlsPerRequest?: number;
  ragTopKChunks?: number;
  ragChunkChars?: number;
  ragCacheTtlSeconds?: number;
  ragEmbeddingModel?: string;

  maxTurns?: number;
  maxCharsPerMessage?: number;

  rateLimit?: RateLimitConfig;

  dailyBudget?: DailyBudgetConfig;

  actions?: BotActionConfig;

  schemaVersion?: number;
};

type ChatOk = {
  ok: true;
  message: string;
  reply: string;
  raw?: unknown;
  action?: {
    type: ActionType;
    contactUrl?: string;
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
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

type HeaderDict = Record<string, string>;

function json(status: number, body: Record<string, unknown>, extraHeaders?: HeaderDict) {
  const headers: HeaderDict = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(extraHeaders ?? {}),
  };
  return new Response(JSON.stringify(body), { status, headers });
}

function getHeader(req: Request, name: string) {
  const v = req.headers.get(name);
  return typeof v === "string" ? v : "";
}

/**
 * For origin allowlisting, ONLY trust the browser-supplied Origin header.
 * (curl/PowerShell typically won't include Origin, and should still work.)
 */
function getRequestOrigin(req: Request) {
  return getHeader(req, "origin").trim();
}

function parseBearerToken(req: Request) {
  const h = getHeader(req, "authorization");
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1]?.trim() || "";
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** loose bot-id matching helpers */
function normalizeBotIdLoose(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

async function resolveBotId(env: Env, botId: string): Promise<string | null> {
  const raw = String(botId || "").trim();
  if (!raw) return null;

  const exact = await env.BOT_CONFIG.get(`cfg:${raw}`);
  if (exact) return raw;

  const idxRaw = (await env.BOT_CONFIG.get("cfg:index")) || "[]";
  let ids: string[] = [];
  try {
    ids = JSON.parse(idxRaw);
  } catch {
    ids = [];
  }

  const wantLoose = normalizeBotIdLoose(raw);
  const wantLower = raw.toLowerCase();

  for (const id of ids) {
    if (!id) continue;
    if (id.toLowerCase() === wantLower) return id;
    if (normalizeBotIdLoose(id) === wantLoose) return id;
  }

  return null;
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
    } catch {}
  }
  return out;
}

/**
 * allowedOrigins can include:
 * - exact origins: "https://example.com"
 * - wildcard origins: "https://*.vercel.app"
 */
function sanitizeOrigins(origins: unknown, max = 25) {
  if (!Array.isArray(origins)) return [];
  const out: string[] = [];
  for (const o of origins) {
    if (typeof o !== "string") continue;
    const s = o.trim();
    if (!s) continue;

    if (s.includes("*")) {
      if (!/^https?:\/\/\*\.[a-z0-9.-]+$/i.test(s)) continue;
      out.push(s);
      if (out.length >= max) break;
      continue;
    }

    try {
      const u = new URL(s);
      out.push(u.origin);
      if (out.length >= max) break;
    } catch {}
  }
  return Array.from(new Set(out));
}

function isOriginAllowed(origin: string, allowedOrigins: string[] | undefined) {
  if (!origin) return false;
  if (!allowedOrigins || !allowedOrigins.length) return true;

  let o = "";
  try {
    o = new URL(origin).origin;
  } catch {
    return false;
  }

  for (const allowed of allowedOrigins) {
    if (!allowed) continue;

    // Exact match
    if (!allowed.includes("*")) {
      if (allowed === o) return true;
      continue;
    }

    // Wildcard match: https://*.vercel.app
    const m = /^(https?:\/\/)\*\.(.+)$/i.exec(allowed);
    if (!m) continue;

    const scheme = m[1].toLowerCase();
    const suffix = m[2].toLowerCase();

    const om = /^(https?:\/\/)(.+)$/i.exec(o);
    if (!om) continue;

    const oScheme = om[1].toLowerCase();
    const host = om[2].toLowerCase();

    if (oScheme !== scheme) continue;
    if (host === suffix) continue; // require a subdomain
    if (host.endsWith("." + suffix)) return true;
  }

  return false;
}

function clampInt(n: unknown, def: number, min: number, max: number) {
  const x = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  if (!Number.isFinite(x)) return def;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function stripHtmlToText(html: string) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeActionConfig(v: any): BotActionConfig | undefined {
  if (!v || typeof v !== "object") return undefined;

  const allowed = Array.isArray(v.allowedActionTypes)
    ? (v.allowedActionTypes.filter(
        (t: any) => t === "open_contact" || t === "create_lead" || t === "webhook" || t === "none"
      ) as ActionType[])
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

function normalizeDailyBudget(v: any, existing?: DailyBudgetConfig): DailyBudgetConfig | undefined {
  if (!v && !existing) return undefined;
  const maxRequestsPerDay = clampInt(v?.maxRequestsPerDay, existing?.maxRequestsPerDay ?? 300, 0, 100000);
  const maxTokensPerDay = clampInt(v?.maxTokensPerDay, existing?.maxTokensPerDay ?? 0, 0, 50_000_000);
  return { maxRequestsPerDay, maxTokensPerDay };
}

function normalizeConfig(incoming: any, existing?: BotConfig): BotConfig {
  const botId = typeof incoming?.botId === "string" ? incoming.botId.trim() : "";
  if (!botId) throw new Error("Missing botId");

  const cfg: BotConfig = {
    botId,
    schemaVersion: 3,

    siteName: typeof incoming?.siteName === "string" ? incoming.siteName.trim() : existing?.siteName,
    contactUrl: typeof incoming?.contactUrl === "string" ? incoming.contactUrl.trim() : existing?.contactUrl,
    tone: typeof incoming?.tone === "string" ? incoming.tone.trim() : existing?.tone,

    model: typeof incoming?.model === "string" ? incoming.model.trim() : existing?.model,
    maxTokens: clampInt(incoming?.maxTokens, existing?.maxTokens ?? 512, 64, GLOBAL_MAX_TOKENS),

    allowedOrigins: sanitizeOrigins(incoming?.allowedOrigins ?? existing?.allowedOrigins),

    botKey: typeof incoming?.botKey === "string" ? incoming.botKey.trim() : existing?.botKey,

    leadMode:
      incoming?.leadMode === "soft" || incoming?.leadMode === "balanced" || incoming?.leadMode === "direct"
        ? incoming.leadMode
        : existing?.leadMode ?? "balanced",

    qualifyingQuestions: Array.isArray(incoming?.qualifyingQuestions)
      ? incoming.qualifyingQuestions
          .filter((x: any) => typeof x === "string")
          .map((s: string) => s.trim())
          .filter(Boolean)
          .slice(0, 10)
      : existing?.qualifyingQuestions,

    knowledge: typeof incoming?.knowledge === "string" ? incoming.knowledge : existing?.knowledge,

    knowledgeUrls: sanitizeUrlList(incoming?.knowledgeUrls ?? existing?.knowledgeUrls),
    ragEnabled: typeof incoming?.ragEnabled === "boolean" ? incoming.ragEnabled : existing?.ragEnabled ?? false,
    ragMode: incoming?.ragMode === "simple" || incoming?.ragMode === "embed" ? incoming.ragMode : existing?.ragMode,
    ragMaxUrlsPerRequest: clampInt(
      incoming?.ragMaxUrlsPerRequest,
      existing?.ragMaxUrlsPerRequest ?? 2,
      0,
      GLOBAL_RAG_MAX_URLS
    ),
    ragTopKChunks: clampInt(incoming?.ragTopKChunks, existing?.ragTopKChunks ?? 4, 1, GLOBAL_RAG_MAX_TOPK),
    ragChunkChars: clampInt(incoming?.ragChunkChars, existing?.ragChunkChars ?? 1200, 300, GLOBAL_RAG_MAX_CHUNK_CHARS),
    ragCacheTtlSeconds: clampInt(incoming?.ragCacheTtlSeconds, existing?.ragCacheTtlSeconds ?? 86400, 60, 7 * 86400),
    ragEmbeddingModel:
      typeof incoming?.ragEmbeddingModel === "string"
        ? incoming.ragEmbeddingModel.trim()
        : existing?.ragEmbeddingModel,

    maxTurns: clampInt(incoming?.maxTurns, existing?.maxTurns ?? 20, 4, GLOBAL_MAX_TURNS),
    maxCharsPerMessage: clampInt(
      incoming?.maxCharsPerMessage,
      existing?.maxCharsPerMessage ?? 4000,
      200,
      GLOBAL_MAX_CHARS_PER_MESSAGE
    ),

    rateLimit: {
      limit: clampInt(incoming?.rateLimit?.limit, existing?.rateLimit?.limit ?? 12, 1, 120),
      windowSeconds: clampInt(incoming?.rateLimit?.windowSeconds, existing?.rateLimit?.windowSeconds ?? 60, 10, 3600),
    },

    dailyBudget: normalizeDailyBudget(incoming?.dailyBudget, existing?.dailyBudget),

    actions: normalizeActionConfig(incoming?.actions ?? existing?.actions),
  };

  if (!cfg.contactUrl) cfg.contactUrl = "/contact";
  if (!cfg.siteName) cfg.siteName = cfg.botId;

  if (typeof cfg.knowledge === "string" && cfg.knowledge.length > 200_000) {
    cfg.knowledge = cfg.knowledge.slice(0, 200_000);
  }
  cfg.knowledgeUrls = (cfg.knowledgeUrls || []).slice(0, 50);

  return cfg;
}

/** ===== CORS headers ===== */

function corsHeadersForOrigin(origin?: string): HeaderDict {
  const h: HeaderDict = {
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-bot-key, x-admin-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (origin) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Vary"] = "Origin";
  }
  return h;
}

/** ===== Rate limiting ===== */

function ipFromReq(req: Request) {
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

  await env.KB_CACHE.put(key, String(current + 1), { expirationTtl: windowSeconds + 10 });
  return { ok: true as const, limit, windowSeconds };
}

/** ===== Daily budgets ===== */

function utcDayKey(ts = Date.now()) {
  const d = new Date(ts);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

type BudgetState = { requests: number; tokens: number };

async function getBudgetState(env: Env, botId: string, dayKey: string): Promise<BudgetState> {
  const key = `${BUDGET_KEY_PREFIX}:${dayKey}:${botId}`;
  const raw = await env.KB_CACHE.get(key);
  const parsed = raw ? safeJsonParse(raw) : null;
  const requests = Number((parsed as any)?.requests ?? 0) || 0;
  const tokens = Number((parsed as any)?.tokens ?? 0) || 0;
  return { requests, tokens };
}

async function putBudgetState(env: Env, botId: string, dayKey: string, state: BudgetState) {
  const key = `${BUDGET_KEY_PREFIX}:${dayKey}:${botId}`;
  await env.KB_CACHE.put(key, JSON.stringify(state), { expirationTtl: 3 * 86400 });
}

async function checkDailyBudget(env: Env, cfg: BotConfig, requestId: string) {
  const b = cfg.dailyBudget;
  if (!b) return { ok: true as const };

  const maxReq = clampInt(b.maxRequestsPerDay, 0, 0, 100000000);
  const maxTok = clampInt(b.maxTokensPerDay, 0, 0, 100000000);

  if (maxReq <= 0 && maxTok <= 0) return { ok: true as const };

  const dayKey = utcDayKey();
  const state = await getBudgetState(env, cfg.botId, dayKey);

  if (maxReq > 0 && state.requests >= maxReq) {
    return {
      ok: false as const,
      error: "BUDGET_EXCEEDED",
      detail: `Daily request budget exceeded for botId "${cfg.botId}".`,
      dayKey,
      requestId,
    };
  }

  if (maxTok > 0 && state.tokens >= maxTok) {
    return {
      ok: false as const,
      error: "BUDGET_EXCEEDED",
      detail: `Daily token budget exceeded for botId "${cfg.botId}".`,
      dayKey,
      requestId,
    };
  }

  return { ok: true as const, dayKey, state, maxReq, maxTok };
}

async function incrementDailyBudget(
  env: Env,
  cfg: BotConfig,
  dayKey: string,
  state: BudgetState,
  addRequests: number,
  addTokens: number
) {
  const next: BudgetState = {
    requests: Math.max(0, state.requests + Math.max(0, addRequests)),
    tokens: Math.max(0, state.tokens + Math.max(0, addTokens)),
  };
  await putBudgetState(env, cfg.botId, dayKey, next);
}

/** ===== Knowledge / RAG ===== */

async function getCachedUrlText(env: Env, url: string, ttlSeconds = 3600, force = false) {
  const cacheKey = `kb:${url}`;
  if (!force) {
    const cached = await env.KB_CACHE.get(cacheKey);
    if (cached) return cached;
  }

  const res = await fetch(url, { method: "GET", headers: { "User-Agent": "EVAVO-ChatPlatform/1.0" } });
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

    for (const term of q.split(/\W+/g).filter(Boolean).slice(0, 20)) {
      if (term.length < 3) continue;
      if (p.includes(term)) score += 2;
    }

    if (q.includes("price") || q.includes("pricing") || q.includes("cost")) if (p.includes("pricing")) score += 5;
    if (q.includes("contact") || q.includes("quote")) if (p.includes("contact")) score += 5;
    if (q.includes("privacy")) if (p.includes("privacy")) score += 5;
    if (q.includes("terms")) if (p.includes("terms")) score += 5;

    return { u, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.u);
}

function chunkText(text: string, chunkChars: number, maxChunks: number) {
  const t = (text || "").trim();
  if (!t) return [];
  const size = Math.max(300, Math.min(GLOBAL_RAG_MAX_CHUNK_CHARS, chunkChars || 1200));
  const chunks: string[] = [];
  for (let i = 0; i < t.length; i += size) {
    const part = t.slice(i, i + size).trim();
    if (part.length >= 80) chunks.push(part);
    if (chunks.length >= maxChunks) break;
  }
  return chunks;
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
    const res1 = await (env.AI as any).run(model, { text });
    const vec = (res1 &&
      ((res1.data as any) || (res1.embedding as any) || (res1.vector as any) || (res1[0] as any))) as any;
    if (Array.isArray(vec) && vec.length) return vec.map((n: any) => Number(n));
  } catch {}

  try {
    const res2 = await (env.AI as any).run(model, { texts: [text] });
    const vec = (res2 && ((res2.data?.[0] as any) || (res2.embeddings?.[0] as any) || (res2[0] as any))) as any;
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

function truncateTextToLimit(s: string, maxChars: number) {
  const t = (s || "").toString();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars - 1) + "…";
}

async function buildRagBlock(env: Env, cfg: BotConfig, question: string) {
  const urls = Array.isArray(cfg.knowledgeUrls) ? cfg.knowledgeUrls.filter(Boolean) : [];
  if (!cfg.ragEnabled || !urls.length) return "";

  const maxUrls = clampInt(cfg.ragMaxUrlsPerRequest, 2, 0, GLOBAL_RAG_MAX_URLS);
  if (maxUrls <= 0) return "";

  const ttl = clampInt(cfg.ragCacheTtlSeconds, 86400, 60, 7 * 86400);
  const mode = (cfg.ragMode || "simple") as "simple" | "embed";

  const chosen = selectRelevantUrls(question, urls, maxUrls);
  if (!chosen.length) return "";

  const texts: Array<{ url: string; text: string }> = [];
  for (const u of chosen) {
    try {
      const t = await getCachedUrlText(env, u, ttl);
      if (t) texts.push({ url: u, text: t });
    } catch {}
  }
  if (!texts.length) return "";

  if (mode !== "embed") {
    const blocks = texts
      .map(({ url, text }) => `SOURCE: ${url}\n${text.slice(0, 2800)}`)
      .join("\n\n---\n\n");
    return `\n\nWebsite sources (use only these for factual claims; if not present, say you’re unsure and link the relevant page):\n\n${blocks}`;
  }

  const embedModel = (cfg.ragEmbeddingModel || "@cf/baai/bge-base-en-v1.5").trim();
  const topK = clampInt(cfg.ragTopKChunks, 4, 1, GLOBAL_RAG_MAX_TOPK);
  const chunkChars = clampInt(cfg.ragChunkChars, 1200, 300, GLOBAL_RAG_MAX_CHUNK_CHARS);

  const qVec = await getCachedEmbedding(env, embedModel, question.slice(0, 2000), ttl);
  if (!qVec) {
    const blocks = texts
      .map(({ url, text }) => `SOURCE: ${url}\n${text.slice(0, 2800)}`)
      .join("\n\n---\n\n");
    return `\n\nWebsite sources (embeddings unavailable; fallback to raw excerpts):\n\n${blocks}`;
  }

  const scoredChunks: Array<{ url: string; chunk: string; score: number }> = [];

  for (const { url, text } of texts) {
    const chunks = chunkText(text, chunkChars, GLOBAL_RAG_EMBED_MAX_CHUNKS_PER_PAGE);
    for (const chunk of chunks) {
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

  return `\n\nWebsite sources (ranked excerpts; do not invent details; if pricing/SLAs not shown here, say so and link the relevant page):\n\n${blocks}`;
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

  const actionsEnabled = cfg.actions?.actionsEnabled ? true : false;
  const allowedActions = cfg.actions?.allowedActionTypes?.length
    ? cfg.actions.allowedActionTypes
    : actionsEnabled
      ? (["open_contact", "create_lead", "webhook", "none"] as ActionType[])
      : (["none"] as ActionType[]);

  const actionBlock = actionsEnabled
    ? `\nActions:\nYou may optionally return a JSON object instead of plain text.\nAllowed action types: ${allowedActions.join(
        ", "
      )}.\nJSON format:\n{\n  "message": "string (human reply)",\n  "action": {\n    "type": "open_contact|create_lead|webhook|none",\n    "payload": { /* minimal structured data */ }\n  }\n}\nRules:\n- Prefer plain text unless an action will materially help.\n- Only include user-provided details in payload.\n- Never invent phone numbers, emails, addresses, prices, SLAs, compliance claims, or guarantees.\n`
    : `\nActions:\nDo NOT output JSON. Only output normal text.\n`;

  const leadStyle =
    leadMode === "soft"
      ? "Be helpful first; only mention contacting sales when the user asks."
      : leadMode === "direct"
        ? "Guide toward a quote once you have minimal scoping info; politely ask qualifying questions."
        : "Answer and educate, then offer a quote/next step if relevant.";

  const truthRules = [
    "Truthfulness rules:",
    "- Do NOT invent numbers (prices, discounts, minimums), SLAs, certifications, or legal/compliance statements.",
    "- If asked for pricing and exact figures are not in the provided website sources, say pricing depends on scope and link the pricing page.",
    "- If asked about compliance/certs (ISO, SOC2, etc.) and it is not in the sources, say you can’t confirm from the site and suggest contacting the team.",
    "- If unsure, say so and ask a short clarifying question or point to the relevant page.",
    "- Keep replies concise and practical.",
  ].join("\n");

  return [
    `You are the website assistant for "${cfg.siteName || cfg.botId}".`,
    `Tone: ${tone}.`,
    `Behavior: ${leadStyle}`,
    truthRules,
    qBlock,
    actionBlock,
  ]
    .filter(Boolean)
    .join("\n");
}

function extractActionFromModelOutput(rawText: string): { message: string; action?: { type: ActionType; payload?: any } } {
  const trimmed = (rawText || "").trim();

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

/** ===== Leads storage (KV) ===== */

async function storeLead(env: Env, cfg: BotConfig, payload: any) {
  const botId = cfg.botId;
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  const key = `lead:${botId}:${ts}:${rand}`;

  const record = { botId, createdAt: new Date(ts).toISOString(), payload };

  await env.BOT_CONFIG.put(key, JSON.stringify(record));

  const indexKey = `lead:index:${botId}`;
  const rawIdx = (await env.BOT_CONFIG.get(indexKey)) || "[]";
  let arr: string[] = [];
  try {
    arr = JSON.parse(rawIdx);
  } catch {
    arr = [];
  }
  arr.push(key);
  if (arr.length > 500) arr = arr.slice(arr.length - 500);
  await env.BOT_CONFIG.put(indexKey, JSON.stringify(arr));

  return { key, record };
}

async function listLeads(env: Env, botId: string) {
  const indexKey = `lead:index:${botId}`;
  const rawIdx = (await env.BOT_CONFIG.get(indexKey)) || "[]";
  let arr: string[] = [];
  try {
    arr = JSON.parse(rawIdx);
  } catch {
    arr = [];
  }
  return arr;
}

/** ===== Webhook firing ===== */

async function maybeFireWebhook(env: Env, cfg: BotConfig, action: { type: ActionType; payload?: any }, requestId: string) {
  const a = cfg.actions;
  if (!a?.actionsEnabled) return;
  if (!a.webhookUrl) return;
  if (action.type !== "create_lead" && action.type !== "webhook") return;

  const headers: HeaderDict = {
    "Content-Type": "application/json",
    "x-chat-platform-botid": cfg.botId,
    "x-chat-platform-requestid": requestId,
  };

  if (a.webhookAuthHeader) {
    const idx = a.webhookAuthHeader.indexOf(":");
    if (idx > 0) headers[a.webhookAuthHeader.slice(0, idx).trim()] = a.webhookAuthHeader.slice(idx + 1).trim();
    else headers["Authorization"] = a.webhookAuthHeader;
  }
  if (a.webhookSecret) headers["x-chat-platform-signature"] = a.webhookSecret;

  try {
    await fetch(a.webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ botId: cfg.botId, siteName: cfg.siteName, action, ts: Date.now() }),
    });
  } catch {}
}

/** ===== Admin auth (FIXED) ===== */

function getAdminToken(env: Env): string | null {
  const t = (env.ADMIN_TOKEN ?? "").trim();
  return t.length ? t : null;
}

function getPresentedAdminToken(req: Request): string {
  const bearer = parseBearerToken(req);
  const alt = getHeader(req, "x-admin-token").trim();
  return (bearer || alt || "").trim();
}

/**
 * Returns null if ok; otherwise returns a Response.
 * - If ADMIN_TOKEN not configured => 500 ADMIN_NOT_CONFIGURED
 * - If token missing/incorrect => 401 UNAUTHORIZED
 */
function requireAdminOrResponse(req: Request, env: Env, requestId: string): Response | null {
  const expected = getAdminToken(env);
  if (!expected) {
    return json(500, { ok: false, error: "ADMIN_NOT_CONFIGURED", detail: "ADMIN_TOKEN is not set.", requestId });
  }

  const token = getPresentedAdminToken(req);
  if (!token) {
    return json(401, { ok: false, error: "UNAUTHORIZED", detail: "Missing admin token.", requestId });
  }

  if (!constantTimeEqual(token, expected)) {
    return json(401, { ok: false, error: "UNAUTHORIZED", detail: "Invalid admin token.", requestId });
  }

  return null;
}

/** ===== Admin handlers ===== */

async function handleAdminUpsert(req: Request, env: Env, requestId: string) {
  const denied = requireAdminOrResponse(req, env, requestId);
  if (denied) return denied;

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
  await recordBotId(env, botId);

  return json(200, { ok: true, cfg, requestId }, { "x-request-id": requestId });
}

async function handleAdminGet(req: Request, env: Env, requestId: string) {
  const denied = requireAdminOrResponse(req, env, requestId);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const botIdInput = typeof (body as any)?.botId === "string" ? (body as any).botId.trim() : "";
  if (!botIdInput) return json(400, { ok: false, error: "BAD_REQUEST", detail: "Missing botId.", requestId });

  const resolved = await resolveBotId(env, botIdInput);
  if (!resolved) return json(404, { ok: false, error: "NOT_FOUND", detail: "Bot config not found.", requestId });

  const raw = await env.BOT_CONFIG.get(`cfg:${resolved}`);
  if (!raw) return json(404, { ok: false, error: "NOT_FOUND", detail: "Bot config not found.", requestId });

  return json(200, { ok: true, cfg: safeJsonParse(raw), requestId });
}

async function handleAdminList(req: Request, env: Env, requestId: string) {
  const denied = requireAdminOrResponse(req, env, requestId);
  if (denied) return denied;

  const raw = await env.BOT_CONFIG.get("cfg:index");
  const parsed = safeJsonParse(raw || "[]");
  let ids = Array.isArray(parsed) ? (parsed as string[]) : [];
  ids = Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
  return json(200, { ok: true, botIds: ids, requestId });
}

async function handleAdminLeadsList(req: Request, env: Env, requestId: string) {
  const denied = requireAdminOrResponse(req, env, requestId);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const botIdInput = typeof (body as any)?.botId === "string" ? (body as any).botId.trim() : "";
  if (!botIdInput) return json(400, { ok: false, error: "BAD_REQUEST", detail: "Missing botId.", requestId });

  const resolved = await resolveBotId(env, botIdInput);
  if (!resolved) return json(404, { ok: false, error: "NOT_FOUND", detail: "Bot config not found.", requestId });

  const keys = await listLeads(env, resolved);
  return json(200, { ok: true, botId: resolved, keys: keys.slice().reverse(), requestId });
}

async function handleAdminLeadsGet(req: Request, env: Env, requestId: string) {
  const denied = requireAdminOrResponse(req, env, requestId);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const key = typeof (body as any)?.key === "string" ? (body as any).key.trim() : "";
  if (!key) return json(400, { ok: false, error: "BAD_REQUEST", detail: "Missing key.", requestId });

  const raw = await env.BOT_CONFIG.get(key);
  if (!raw) return json(404, { ok: false, error: "NOT_FOUND", detail: "Lead not found.", requestId });

  return json(200, { ok: true, lead: safeJsonParse(raw), requestId });
}

async function recordBotId(env: Env, botId: string) {
  const raw = await env.BOT_CONFIG.get("cfg:index");
  const parsed = safeJsonParse(raw || "[]");
  const ids = Array.isArray(parsed) ? (parsed as string[]) : [];
  if (!ids.includes(botId)) {
    ids.push(botId);
    await env.BOT_CONFIG.put("cfg:index", JSON.stringify(ids.slice(-500)));
  }
}

async function handleKbRefresh(req: Request, env: Env, requestId: string) {
  const denied = requireAdminOrResponse(req, env, requestId);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const botIdInput = typeof (body as any)?.botId === "string" ? (body as any).botId.trim() : "";
  if (!botIdInput) return json(400, { ok: false, error: "BAD_REQUEST", detail: "Missing botId.", requestId });

  const resolved = await resolveBotId(env, botIdInput);
  if (!resolved) return json(404, { ok: false, error: "NOT_FOUND", detail: "Bot config not found.", requestId });

  const raw = await env.BOT_CONFIG.get(`cfg:${resolved}`);
  if (!raw) return json(404, { ok: false, error: "NOT_FOUND", detail: "Bot config not found.", requestId });

  const cfg = safeJsonParse(raw) as BotConfig;
  const urls = sanitizeUrlList(cfg?.knowledgeUrls);
  if (!urls.length) return json(200, { ok: true, refreshed: 0, requestId });

  const ttl = clampInt(cfg.ragCacheTtlSeconds, 86400, 60, 7 * 86400);

  let refreshed = 0;
  for (const u of urls.slice(0, 30)) {
    try {
      await getCachedUrlText(env, u, ttl, true);
      refreshed++;
    } catch {}
  }
  return json(200, { ok: true, refreshed, requestId });
}

/** ===== Admin cleanup helpers (NEW) ===== */

async function handleAdminDelete(req: Request, env: Env, requestId: string) {
  const denied = requireAdminOrResponse(req, env, requestId);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const botIdInput = typeof (body as any)?.botId === "string" ? (body as any).botId.trim() : "";
  if (!botIdInput) return json(400, { ok: false, error: "BAD_REQUEST", detail: "Missing botId.", requestId });

  const resolved = await resolveBotId(env, botIdInput);
  if (!resolved) return json(404, { ok: false, error: "NOT_FOUND", detail: "Bot config not found.", requestId });

  // Delete config
  await env.BOT_CONFIG.delete(`cfg:${resolved}`);

  // Remove from cfg:index
  const raw = await env.BOT_CONFIG.get("cfg:index");
  const parsed = safeJsonParse(raw || "[]");
  const ids = Array.isArray(parsed) ? (parsed as string[]) : [];
  const next = ids.filter((x) => x && x !== resolved);
  await env.BOT_CONFIG.put("cfg:index", JSON.stringify(next.slice(-500)));

  return json(200, { ok: true, deleted: resolved, requestId });
}

async function handleAdminNuke(req: Request, env: Env, requestId: string) {
  const denied = requireAdminOrResponse(req, env, requestId);
  if (denied) return denied;

  // Deletes only known bot configs (from cfg:index) + index itself.
  // This avoids iterating all KV keys (KV list isn't available here anyway).
  const raw = await env.BOT_CONFIG.get("cfg:index");
  const parsed = safeJsonParse(raw || "[]");
  const ids = Array.isArray(parsed) ? (parsed as string[]) : [];

  let deleted = 0;
  for (const id of ids) {
    if (!id) continue;
    try {
      await env.BOT_CONFIG.delete(`cfg:${id}`);
      deleted++;
    } catch {}
  }

  await env.BOT_CONFIG.put("cfg:index", "[]");

  return json(200, { ok: true, deletedBots: deleted, requestId });
}

/** ===== Chat handler ===== */

function getBotKeyFromReq(req: Request, body: any) {
  const headerKey = getHeader(req, "x-bot-key").trim();
  const bodyKey = typeof body?.botKey === "string" ? body.botKey.trim() : "";
  return headerKey || bodyKey;
}

function estimateTokensFromText(s: string) {
  const chars = (s || "").length;
  return Math.max(1, Math.ceil(chars / 4));
}

async function handleChat(req: Request, env: Env, requestId: string) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return json(400, { ok: false, error: "BAD_REQUEST", detail: "Expected JSON.", requestId });
  }

  const botIdInput = typeof (body as any).botId === "string" ? (body as any).botId.trim() : "";
  const messages = Array.isArray((body as any).messages) ? ((body as any).messages as any[]) : [];
  const debug = !!(body as any).debug;

  if (!botIdInput || !messages.length) {
    return json(400, { ok: false, error: "BAD_REQUEST", detail: "Expected { botId, messages[] }.", requestId });
  }

  const resolvedBotId = await resolveBotId(env, botIdInput);
  if (!resolvedBotId) return json(404, { ok: false, error: "NOT_FOUND", detail: "Unknown botId.", requestId });

  const rawCfg = await env.BOT_CONFIG.get(`cfg:${resolvedBotId}`);
  if (!rawCfg) return json(404, { ok: false, error: "NOT_FOUND", detail: "Unknown botId.", requestId });

  const cfg = safeJsonParse(rawCfg) as BotConfig;

  // Optional bot key gate
  if (cfg.botKey && cfg.botKey.trim()) {
    const provided = getBotKeyFromReq(req, body);
    if (!provided || !constantTimeEqual(provided, cfg.botKey.trim())) {
      return json(401, { ok: false, error: "UNAUTHORIZED", detail: "Missing/invalid botKey.", requestId });
    }
  }

  // Origin checks ONLY if Origin header exists
  const origin = getRequestOrigin(req);
  if (origin && !isOriginAllowed(origin, cfg.allowedOrigins)) {
    return json(
      403,
      { ok: false, error: "FORBIDDEN_ORIGIN", detail: "Origin not allowed.", requestId },
      {
        "Access-Control-Allow-Origin": "null",
        Vary: "Origin",
      }
    );
  }

  // Rate limit
  const rl = await checkRateLimit(env, resolvedBotId, req, cfg);
  if (!rl.ok) {
    return json(
      429,
      { ok: false, error: "RATE_LIMITED", detail: `Too many requests. Limit ${rl.limit}/${rl.windowSeconds}s.`, requestId },
      { ...corsHeadersForOrigin(origin || undefined), "Retry-After": String(rl.windowSeconds) }
    );
  }

  // Daily budgets (keys accrue to canonical botId)
  const budgetCfg: BotConfig = { ...(cfg as any), botId: resolvedBotId };
  const budgetCheck = await checkDailyBudget(env, budgetCfg, requestId);
  if (!budgetCheck.ok) {
    return json(
      429,
      { ok: false, error: (budgetCheck as any).error, detail: (budgetCheck as any).detail, requestId },
      { ...corsHeadersForOrigin(origin || undefined), "Retry-After": "3600" }
    );
  }

  const maxTurns = clampInt(cfg.maxTurns, 20, 4, GLOBAL_MAX_TURNS);
  const maxChars = clampInt(cfg.maxCharsPerMessage, 4000, 200, GLOBAL_MAX_CHARS_PER_MESSAGE);

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
    return json(400, { ok: false, error: "BAD_REQUEST", detail: "No valid messages.", requestId });
  }

  const systemPrompt = buildSystemPrompt(cfg);
  const lastUser = [...trimmed].reverse().find((m) => m.role === "user")?.content || "";
  const ragBlock = await buildRagBlock(env, cfg, lastUser);
  const knowledge =
    typeof cfg.knowledge === "string" && cfg.knowledge.trim() ? `\nWebsite notes:\n${cfg.knowledge.trim()}\n` : "";

  const systemContent = truncateTextToLimit(systemPrompt + knowledge + ragBlock, GLOBAL_MAX_SYSTEM_CHARS);

  const input: ChatMessage[] = [{ role: "system", content: systemContent }, ...trimmed];

  // Hard cap total input size
  const totalInputChars = input.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  if (totalInputChars > GLOBAL_MAX_TOTAL_INPUT_CHARS) {
    const kept: ChatMessage[] = [input[0]];
    for (let i = input.length - 1; i >= 1; i--) {
      kept.splice(1, 0, input[i]);
      const sz = kept.reduce((sum, m) => sum + (m.content?.length || 0), 0);
      if (sz > GLOBAL_MAX_TOTAL_INPUT_CHARS) {
        kept.splice(1, 1);
        break;
      }
    }
    input.length = 0;
    input.push(...kept);
  }

  const model = cfg.model?.trim() || "@cf/meta/llama-3-8b-instruct";
  const maxTokens = clampInt(cfg.maxTokens, 512, 64, GLOBAL_MAX_TOKENS);

  const estimatedPromptTokens = input.reduce((sum, m) => sum + estimateTokensFromText(m.content), 0);

  let aiResult: any;
  try {
    aiResult = await env.AI.run(model, {
      messages: input.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: maxTokens,
    });
  } catch (e: any) {
    return json(
      502,
      { ok: false, error: "AI_ERROR", detail: e?.message || "AI call failed.", requestId },
      corsHeadersForOrigin(origin || undefined)
    );
  }

  const rawText =
    (aiResult?.response && typeof aiResult.response === "string" ? aiResult.response : "") ||
    (aiResult?.result?.response && typeof aiResult.result.response === "string" ? aiResult.result.response : "") ||
    (aiResult?.output_text && typeof aiResult.output_text === "string" ? aiResult.output_text : "") ||
    "";

  const usage = aiResult?.usage || aiResult?.result?.usage || aiResult?.raw?.usage || null;
  const totalTokensFromModel =
    typeof (usage as any)?.total_tokens === "number"
      ? (usage as any).total_tokens
      : typeof (usage as any)?.totalTokens === "number"
        ? (usage as any).totalTokens
        : null;

  const completionTokensEstimate = estimateTokensFromText(rawText);
  const totalTokensEstimate = totalTokensFromModel ?? estimatedPromptTokens + completionTokensEstimate;

  // Update daily budgets after successful call
  if ((budgetCheck as any).ok && (budgetCheck as any).dayKey && (budgetCheck as any).state) {
    await incrementDailyBudget(
      env,
      budgetCfg,
      (budgetCheck as any).dayKey,
      (budgetCheck as any).state,
      1,
      totalTokensEstimate
    ).catch(() => {});
  }

  const { message, action } = extractActionFromModelOutput(rawText);

  // Allowed actions enforcement
  let finalAction = action;
  if (finalAction?.type) {
    const enabled = !!cfg.actions?.actionsEnabled;
    const allowed =
      cfg.actions?.allowedActionTypes?.length
        ? cfg.actions.allowedActionTypes
        : enabled
          ? (["open_contact", "create_lead", "webhook", "none"] as ActionType[])
          : (["none"] as ActionType[]);

    if (!enabled) finalAction = undefined;
    else if (!allowed.includes(finalAction.type)) finalAction = { type: "none" };

    if (finalAction?.type === "create_lead") {
      try {
        await storeLead(env, cfg, finalAction.payload);
      } catch {}
    }
  }

  const safeMessage = (message || "").trim() || "Sorry — I couldn’t generate a response.";

  if (finalAction?.type) await maybeFireWebhook(env, cfg, finalAction, requestId);

  const out: ChatOk = {
    ok: true,
    message: safeMessage,
    reply: safeMessage,
    ...(debug ? { raw: aiResult } : {}),
    action: finalAction
      ? {
          type: finalAction.type,
          contactUrl: finalAction.type === "open_contact" ? cfg.contactUrl || "/contact" : undefined,
          payload: finalAction.payload,
        }
      : undefined,
    requestId,
  };

  return json(200, out, { ...corsHeadersForOrigin(origin || undefined), "x-request-id": requestId });
}

/** ===== Router ===== */

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const requestId = uid();
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      const origin = getRequestOrigin(req);
      return new Response(null, {
        status: 204,
        headers: {
          "Cache-Control": "no-store",
          ...corsHeadersForOrigin(origin || undefined),
        },
      });
    }

    try {
      // Health (always available)
      if (url.pathname === "/health" && (req.method === "GET" || req.method === "POST")) {
        const hasAdmin = !!getAdminToken(env);
        return json(200, { ok: true, adminConfigured: hasAdmin, requestId });
      }

      // Admin
      if (url.pathname === "/admin/upsert" && req.method === "POST") return await handleAdminUpsert(req, env, requestId);
      if (url.pathname === "/admin/get" && req.method === "POST") return await handleAdminGet(req, env, requestId);
      if (url.pathname === "/admin/list" && req.method === "POST") return await handleAdminList(req, env, requestId);

      if (url.pathname === "/admin/leads/list" && req.method === "POST")
        return await handleAdminLeadsList(req, env, requestId);
      if (url.pathname === "/admin/leads/get" && req.method === "POST")
        return await handleAdminLeadsGet(req, env, requestId);

      if (url.pathname === "/admin/kb/refresh" && req.method === "POST")
        return await handleKbRefresh(req, env, requestId);

      // NEW cleanup routes
      if (url.pathname === "/admin/delete" && req.method === "POST") return await handleAdminDelete(req, env, requestId);
      if (url.pathname === "/admin/nuke" && req.method === "POST") return await handleAdminNuke(req, env, requestId);

      // Chat
      if (url.pathname === "/api/chat" && req.method === "POST") return await handleChat(req, env, requestId);

      return json(404, { ok: false, error: "NOT_FOUND", detail: "No such route.", requestId });
    } catch (e: any) {
      const msg = e?.message || "SERVER_ERROR";
      const status = msg === "UNAUTHORIZED" ? 401 : 500;
      return json(status, {
        ok: false,
        error: msg === "UNAUTHORIZED" ? "UNAUTHORIZED" : "SERVER_ERROR",
        detail: msg,
        requestId,
      });
    }
  },
};