import legacyWorker, { type Env as LegacyEnv } from "./index";
import {
  ADMIN_REQUEST_MAX_BYTES,
  CHAT_REQUEST_MAX_BYTES,
  fetchBoundedPublicText,
  isAdminRequestAuthorized,
  normalizeAllowedOrigin,
  normalizePublicHttpsUrl,
  readBoundedJsonObject,
} from "./security";

export interface Env extends LegacyEnv {}

type JsonObject = Record<string, unknown>;
type StoredBotConfig = JsonObject & {
  botId?: unknown;
  allowedOrigins?: unknown;
  botKey?: unknown;
  knowledge?: unknown;
  knowledgeUrls?: unknown;
  ragEnabled?: unknown;
  ragMaxUrlsPerRequest?: unknown;
  ragCacheTtlSeconds?: unknown;
  contactUrl?: unknown;
  actions?: unknown;
};

const ADMIN_PREFIX = "/admin/";
const BOT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SAFE_RESPONSE_BYTES = 512 * 1024;
const MAX_INJECTED_RAG_CHARS = 60_000;
const MAX_KB_REFRESH_URLS = 20;
const ADMIN_JSON_ROUTES = new Set([
  "/admin/upsert",
  "/admin/get",
  "/admin/leads/list",
  "/admin/leads/get",
  "/admin/kb/refresh",
  "/admin/delete",
  "/admin/nuke",
]);

function secureHeaders(initial?: HeadersInit) {
  const headers = new Headers(initial);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  return headers;
}

function json(status: number, body: JsonObject, initialHeaders?: HeadersInit) {
  const headers = secureHeaders(initialHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function configuredAdminTokenAllowed(value: unknown) {
  if (typeof value !== "string" || !value || /\s/.test(value)) return false;
  const bytes = new TextEncoder().encode(value).byteLength;
  return bytes >= 32 && bytes <= 256;
}

function rebuildJsonRequest(request: Request, value: JsonObject) {
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.delete("Content-Length");
  headers.delete("x-admin-token");
  return new Request(request, {
    headers,
    body: JSON.stringify(value),
  });
}

function botId(value: unknown) {
  const candidate = typeof value === "string" ? value.trim() : "";
  return BOT_ID_PATTERN.test(candidate) ? candidate : null;
}

function parseStoredConfig(raw: string | null): StoredBotConfig | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as StoredBotConfig)
      : null;
  } catch {
    return null;
  }
}

function normalizeContactUrl(value: unknown) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) return "/contact";
  if (
    candidate.startsWith("/") &&
    !candidate.startsWith("//") &&
    !candidate.includes("\\") &&
    !candidate.includes("\u0000")
  ) {
    return candidate.slice(0, 512);
  }
  return normalizePublicHttpsUrl(candidate);
}

function normalizeOriginList(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 25) return null;
  const origins: string[] = [];
  for (const item of value) {
    const normalized = normalizeAllowedOrigin(item);
    if (!normalized) return null;
    origins.push(normalized);
  }
  return Array.from(new Set(origins));
}

function normalizeKnowledgeUrls(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 50) return null;
  const urls: string[] = [];
  for (const item of value) {
    const normalized = normalizePublicHttpsUrl(item);
    if (!normalized) return null;
    urls.push(normalized);
  }
  return Array.from(new Set(urls));
}

function normalizeActionConfig(value: unknown) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as JsonObject;
  if (source.webhookUrl || source.webhookAuthHeader || source.webhookSecret) {
    return null;
  }
  const allowed = Array.isArray(source.allowedActionTypes)
    ? source.allowedActionTypes.filter(
        (item): item is string =>
          item === "open_contact" || item === "create_lead" || item === "none",
      )
    : undefined;
  if (
    Array.isArray(source.allowedActionTypes) &&
    allowed?.length !== source.allowedActionTypes.length
  ) {
    return null;
  }
  return {
    actionsEnabled: source.actionsEnabled === true,
    allowedActionTypes: allowed,
  };
}

function sanitizeUpsertPayload(value: JsonObject) {
  const id = botId(value.botId);
  if (!id) return null;
  const allowedOrigins = normalizeOriginList(value.allowedOrigins);
  if (!allowedOrigins) return null;
  const knowledgeUrls = normalizeKnowledgeUrls(value.knowledgeUrls);
  if (knowledgeUrls === null) return null;
  const actions = normalizeActionConfig(value.actions);
  if (actions === null) return null;
  const contactUrl = normalizeContactUrl(value.contactUrl);
  if (!contactUrl) return null;
  if (
    value.model !== undefined &&
    (typeof value.model !== "string" ||
      !/^@cf\/[A-Za-z0-9._/-]{1,120}$/.test(value.model.trim()))
  ) {
    return null;
  }
  if (
    value.botKey !== undefined &&
    (typeof value.botKey !== "string" ||
      value.botKey.length > 256 ||
      /[\s\u0000-\u001f\u007f]/.test(value.botKey))
  ) {
    return null;
  }
  return {
    ...value,
    botId: id,
    allowedOrigins,
    knowledgeUrls,
    actions,
    contactUrl,
    debug: undefined,
  };
}

function safeStoredNetworkConfig(config: StoredBotConfig) {
  const origins = normalizeOriginList(config.allowedOrigins);
  const knowledgeUrls = normalizeKnowledgeUrls(config.knowledgeUrls);
  const contactUrl = normalizeContactUrl(config.contactUrl);
  return origins && knowledgeUrls !== null && contactUrl
    ? { origins, knowledgeUrls: knowledgeUrls ?? [], contactUrl }
    : null;
}

function wildcardOriginMatch(origin: string, allowed: string) {
  if (!allowed.includes("*")) return origin === allowed;
  const match = /^https:\/\/\*\.(.+)$/i.exec(allowed);
  if (!match) return false;
  try {
    const actual = new URL(origin);
    const suffix = match[1].toLowerCase();
    const host = actual.hostname.toLowerCase();
    return (
      actual.protocol === "https:" &&
      host !== suffix &&
      host.endsWith(`.${suffix}`)
    );
  } catch {
    return false;
  }
}

function browserOriginAllowed(request: Request, origins: readonly string[]) {
  const raw = String(request.headers.get("origin") || "").trim();
  if (!raw) return null;
  try {
    const origin = new URL(raw).origin;
    return origins.some((allowed) => wildcardOriginMatch(origin, allowed))
      ? origin
      : false;
  } catch {
    return false;
  }
}

async function resolveBotId(env: Env, requested: string) {
  const exact = await env.BOT_CONFIG.get(`cfg:${requested}`);
  if (exact) return requested;
  const indexRaw = await env.BOT_CONFIG.get("cfg:index");
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(indexRaw || "[]") as unknown;
    ids = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    ids = [];
  }
  const loose = requested.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    ids.find(
      (id) =>
        id.toLowerCase() === requested.toLowerCase() ||
        id.toLowerCase().replace(/[^a-z0-9]/g, "") === loose,
    ) || null
  );
}

function stripHtml(value: string) {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function relevantKnowledgeUrls(question: string, urls: readonly string[], maximum: number) {
  const terms = question
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length >= 3)
    .slice(0, 20);
  return urls
    .map((url) => ({
      url,
      score: terms.reduce(
        (score, term) => score + (url.toLowerCase().includes(term) ? 1 : 0),
        0,
      ),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, maximum)
    .map((item) => item.url);
}

async function safeConfigForChat(
  env: Env,
  config: StoredBotConfig,
  network: NonNullable<ReturnType<typeof safeStoredNetworkConfig>>,
  body: JsonObject,
) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const latestUser = [...messages]
    .reverse()
    .find(
      (message) =>
        message &&
        typeof message === "object" &&
        !Array.isArray(message) &&
        (message as JsonObject).role === "user" &&
        typeof (message as JsonObject).content === "string",
    ) as JsonObject | undefined;
  const question = typeof latestUser?.content === "string" ? latestUser.content : "";
  const maximumUrls = Math.max(
    0,
    Math.min(
      3,
      Number.isFinite(Number(config.ragMaxUrlsPerRequest))
        ? Math.trunc(Number(config.ragMaxUrlsPerRequest))
        : 2,
    ),
  );
  const sources: string[] = [];
  if (config.ragEnabled === true && maximumUrls > 0) {
    for (const url of relevantKnowledgeUrls(
      question,
      network.knowledgeUrls,
      maximumUrls,
    )) {
      const fetched = await fetchBoundedPublicText(url, {
        maximumBytes: 256 * 1024,
        timeoutMs: 8_000,
        maximumRedirects: 3,
      });
      if (!fetched) continue;
      const text = stripHtml(fetched.text).slice(0, 20_000);
      if (text) sources.push(`Source: ${fetched.finalUrl}\n${text}`);
      if (sources.join("\n\n").length >= MAX_INJECTED_RAG_CHARS) break;
    }
  }

  const existingKnowledge =
    typeof config.knowledge === "string"
      ? config.knowledge.slice(0, 200_000)
      : "";
  const externalKnowledge = sources.join("\n\n").slice(0, MAX_INJECTED_RAG_CHARS);
  const actions =
    config.actions && typeof config.actions === "object" && !Array.isArray(config.actions)
      ? (config.actions as JsonObject)
      : {};
  const allowedActions = Array.isArray(actions.allowedActionTypes)
    ? actions.allowedActionTypes.filter(
        (item) =>
          item === "open_contact" || item === "create_lead" || item === "none",
      )
    : ["open_contact", "create_lead", "none"];

  return {
    ...config,
    allowedOrigins: network.origins,
    contactUrl: network.contactUrl,
    knowledge: [existingKnowledge, externalKnowledge].filter(Boolean).join("\n\n"),
    knowledgeUrls: [],
    ragEnabled: false,
    actions: {
      actionsEnabled: actions.actionsEnabled === true,
      allowedActionTypes: allowedActions,
    },
  };
}

function envWithChatConfig(env: Env, canonicalBotId: string, config: JsonObject): Env {
  const binding = new Proxy(env.BOT_CONFIG, {
    get(target, property, receiver) {
      if (property === "get") {
        return async (key: string, ...args: unknown[]) => {
          if (key === `cfg:${canonicalBotId}`) return JSON.stringify(config);
          return (target.get as (...values: unknown[]) => unknown).call(target, key, ...args);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ...env, BOT_CONFIG: binding };
}

async function refreshKnowledge(env: Env, config: StoredBotConfig) {
  const network = safeStoredNetworkConfig(config);
  if (!network) return null;
  const ttl = Math.max(
    60,
    Math.min(
      7 * 86_400,
      Number.isFinite(Number(config.ragCacheTtlSeconds))
        ? Math.trunc(Number(config.ragCacheTtlSeconds))
        : 86_400,
    ),
  );
  let refreshed = 0;
  for (const url of network.knowledgeUrls.slice(0, MAX_KB_REFRESH_URLS)) {
    const fetched = await fetchBoundedPublicText(url, {
      maximumBytes: 256 * 1024,
      timeoutMs: 8_000,
      maximumRedirects: 3,
    });
    if (!fetched) continue;
    const clipped = stripHtml(fetched.text).slice(0, 60_000);
    if (!clipped) continue;
    await env.KB_CACHE.put(`kb:${url}`, clipped, { expirationTtl: ttl });
    refreshed += 1;
  }
  return refreshed;
}

async function sanitizedLegacyResponse(response: Response) {
  const headers = secureHeaders(response.headers);
  const contentType = String(headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return new Response(response.body, { status: response.status, headers });
  }
  const declared = Number(headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_SAFE_RESPONSE_BYTES) {
    return json(502, { ok: false, error: "response_too_large" });
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_SAFE_RESPONSE_BYTES) {
    return json(502, { ok: false, error: "response_too_large" });
  }
  let payload: JsonObject;
  try {
    const parsed = JSON.parse(text) as unknown;
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : { ok: false, error: "invalid_internal_response" };
  } catch {
    payload = { ok: false, error: "invalid_internal_response" };
  }
  delete payload.raw;
  if (response.status >= 400) delete payload.detail;
  return json(response.status, payload, headers);
}

async function parseJsonRoute(request: Request, maximumBytes: number) {
  const parsed = await readBoundedJsonObject(request, maximumBytes);
  return parsed.ok
    ? ({ ok: true, value: parsed.value } as const)
    : ({
        ok: false,
        response: json(parsed.status, { ok: false, error: parsed.error }),
      } as const);
}

function corsPreflight(request: Request, admin: boolean) {
  const origin = String(request.headers.get("origin") || "").trim();
  const headers = secureHeaders({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": admin
      ? "Content-Type, Authorization"
      : "Content-Type, x-bot-key",
    "Access-Control-Max-Age": "600",
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new Response(null, { status: 204, headers });
}

async function handleAdmin(
  request: Request,
  env: Env,
  pathname: string,
) {
  if (!configuredAdminTokenAllowed(env.ADMIN_TOKEN)) {
    return json(503, { ok: false, error: "admin_not_configured" });
  }
  if (!(await isAdminRequestAuthorized(request, env.ADMIN_TOKEN))) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  if (pathname === "/admin/list") {
    return sanitizedLegacyResponse(await legacyWorker.fetch(request, env));
  }
  if (!ADMIN_JSON_ROUTES.has(pathname)) {
    return json(404, { ok: false, error: "not_found" });
  }

  const parsed = await parseJsonRoute(request, ADMIN_REQUEST_MAX_BYTES);
  if (!parsed.ok) return parsed.response;
  let value = parsed.value;

  if (pathname === "/admin/upsert") {
    const sanitized = sanitizeUpsertPayload(value);
    if (!sanitized) {
      return json(400, { ok: false, error: "unsafe_bot_configuration" });
    }
    value = sanitized;
  }
  if (pathname === "/admin/delete" && value.confirm !== "DELETE_BOT") {
    return json(400, { ok: false, error: "delete_confirmation_required" });
  }
  if (pathname === "/admin/nuke" && value.confirm !== "DELETE_ALL_BOTS") {
    return json(400, { ok: false, error: "nuke_confirmation_required" });
  }
  if (pathname === "/admin/leads/get") {
    const key = typeof value.key === "string" ? value.key.trim() : "";
    if (!/^lead:[A-Za-z0-9_-]{1,64}:\d{10,16}:[a-z0-9]{4,16}$/i.test(key)) {
      return json(400, { ok: false, error: "invalid_lead_key" });
    }
  }
  if (pathname === "/admin/kb/refresh") {
    const requestedBotId = botId(value.botId);
    if (!requestedBotId) return json(400, { ok: false, error: "invalid_bot_id" });
    const canonical = await resolveBotId(env, requestedBotId);
    if (!canonical) return json(404, { ok: false, error: "bot_not_found" });
    const config = parseStoredConfig(await env.BOT_CONFIG.get(`cfg:${canonical}`));
    if (!config) return json(404, { ok: false, error: "bot_not_found" });
    const refreshed = await refreshKnowledge(env, config);
    return refreshed === null
      ? json(409, { ok: false, error: "unsafe_bot_configuration" })
      : json(200, { ok: true, refreshed });
  }

  const forwarded = rebuildJsonRequest(request, value);
  return sanitizedLegacyResponse(await legacyWorker.fetch(forwarded, env));
}

async function handleChat(request: Request, env: Env) {
  const parsed = await parseJsonRoute(request, CHAT_REQUEST_MAX_BYTES);
  if (!parsed.ok) return parsed.response;
  const value = parsed.value;
  if (value.debug !== undefined && value.debug !== false) {
    return json(400, { ok: false, error: "debug_output_disabled" });
  }
  delete value.debug;

  const requestedBotId = botId(value.botId);
  if (!requestedBotId || !Array.isArray(value.messages) || value.messages.length === 0) {
    return json(400, { ok: false, error: "invalid_chat_request" });
  }
  const canonical = await resolveBotId(env, requestedBotId);
  if (!canonical) return json(404, { ok: false, error: "bot_not_found" });
  const config = parseStoredConfig(await env.BOT_CONFIG.get(`cfg:${canonical}`));
  if (!config) return json(404, { ok: false, error: "bot_not_found" });
  const network = safeStoredNetworkConfig(config);
  if (!network) return json(409, { ok: false, error: "unsafe_bot_configuration" });

  const originDecision = browserOriginAllowed(request, network.origins);
  if (originDecision === false) {
    return json(403, { ok: false, error: "origin_not_allowed" });
  }
  if (originDecision === null) {
    const configuredBotKey =
      typeof config.botKey === "string" && config.botKey.length >= 16;
    const providedBotKey =
      String(request.headers.get("x-bot-key") || "").trim() ||
      (typeof value.botKey === "string" ? value.botKey.trim() : "");
    if (!configuredBotKey || !providedBotKey) {
      return json(401, { ok: false, error: "bot_key_required" });
    }
  }

  const safeConfig = await safeConfigForChat(env, config, network, value);
  const safeEnv = envWithChatConfig(env, canonical, safeConfig);
  const forwarded = rebuildJsonRequest(request, {
    ...value,
    botId: canonical,
    debug: false,
  });
  return sanitizedLegacyResponse(await legacyWorker.fetch(forwarded, safeEnv));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === "OPTIONS") {
      if (pathname === "/api/chat") return corsPreflight(request, false);
      if (pathname.startsWith(ADMIN_PREFIX)) return corsPreflight(request, true);
      return json(405, { ok: false, error: "method_not_allowed" }, { Allow: "GET, POST" });
    }

    if (pathname === "/health") {
      if (request.method !== "GET") {
        return json(405, { ok: false, error: "method_not_allowed" }, { Allow: "GET" });
      }
      return json(200, {
        ok: true,
        service: "EVAVO Client Chat Platform",
        adminRoutesProtected: true,
        boundedChatRequests: true,
        publicDebugOutput: false,
        externalWebhookExecution: false,
      });
    }

    if (pathname.startsWith(ADMIN_PREFIX)) {
      if (request.method !== "POST") {
        return json(405, { ok: false, error: "method_not_allowed" }, { Allow: "POST" });
      }
      return handleAdmin(request, env, pathname);
    }

    if (pathname === "/api/chat") {
      if (request.method !== "POST") {
        return json(405, { ok: false, error: "method_not_allowed" }, { Allow: "POST" });
      }
      return handleChat(request, env);
    }

    return json(404, { ok: false, error: "not_found" });
  },
};

export const hardenedChatPlatformPosture = Object.freeze({
  legacyRouterWrapped: true,
  boundedAdminJsonBytes: ADMIN_REQUEST_MAX_BYTES,
  boundedChatJsonBytes: CHAT_REQUEST_MAX_BYTES,
  exactBearerAdminAuthentication: true,
  legacyAdminHeaderAllowed: false,
  publicHealthLeaksAdminConfiguration: false,
  browserOriginsDefaultAllow: false,
  serverChatWithoutBotKeyAllowed: false,
  publicDebugOutputAllowed: false,
  arbitraryRagFetchAllowed: false,
  ragFetchesBoundedAndPublicOnly: true,
  legacyExternalWebhookExecutionAllowed: false,
  leadCaptureAllowed: true,
  destructiveAdminConfirmationRequired: true,
  rawProviderErrorsExposed: false,
});
