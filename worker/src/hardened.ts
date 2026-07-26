import legacyWorker, { type Env as LegacyEnv } from "./index";
import {
  browserOriginDecision,
  buildSafeChatConfig,
  normalizeBotId,
  parseStoredConfig,
  refreshBotKnowledge,
  resolveBotId,
  safeStoredNetworkConfig,
  sanitizeUpsertConfig,
  withBotConfigOverride,
  type JsonObject,
} from "./configBoundary";
import {
  ADMIN_REQUEST_MAX_BYTES,
  CHAT_REQUEST_MAX_BYTES,
  boundedSecretEqual,
  configuredAdminTokenAllowed,
  isAdminRequestAuthorized,
  normalizeAllowedOrigin,
  readBoundedJsonObject,
} from "./security";

export interface Env extends LegacyEnv {
  ADMIN_ALLOWED_ORIGINS?: string;
}

const ADMIN_PREFIX = "/admin/";
const MAX_SAFE_RESPONSE_BYTES = 512 * 1024;
const MAX_CHAT_MESSAGES = 30;
const MAX_CHAT_MESSAGE_CHARS = 8_000;
const MAX_TOTAL_CHAT_CHARS = 75_000;
const BOT_KEY_MIN_BYTES = 16;
const BOT_KEY_MAX_BYTES = 256;
const MAX_ADMIN_ORIGINS = 12;
const ADMIN_JSON_ROUTES = new Set([
  "/admin/upsert",
  "/admin/get",
  "/admin/leads/list",
  "/admin/leads/get",
  "/admin/kb/refresh",
  "/admin/delete",
  "/admin/nuke",
]);
const LOOPBACK_ADMIN_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function corsHeaders(origin: string | null) {
  if (!origin) return undefined;
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  } as const;
}

function secureHeaders(initial?: HeadersInit) {
  const headers = new Headers(initial);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return headers;
}

function json(status: number, body: JsonObject, initialHeaders?: HeadersInit) {
  const headers = secureHeaders(initialHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function rebuildJsonRequest(
  request: Request,
  value: JsonObject,
  preserveAuthorization: boolean,
) {
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.delete("Content-Length");
  headers.delete("x-admin-token");
  if (!preserveAuthorization) headers.delete("Authorization");
  return new Request(request, {
    headers,
    body: JSON.stringify(value),
  });
}

function loopbackAdminOrigin(raw: string) {
  try {
    const url = new URL(raw);
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (
      !LOOPBACK_ADMIN_HOSTS.has(hostname) ||
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function configuredAdminOrigins(env: Env) {
  const raw = String(env.ADMIN_ALLOWED_ORIGINS || "").trim();
  if (!raw) return [];
  const candidates = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (candidates.length > MAX_ADMIN_ORIGINS) return [];
  const origins: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeAllowedOrigin(candidate);
    if (!normalized) return [];
    origins.push(normalized);
  }
  return Array.from(new Set(origins));
}

function adminOriginDecision(request: Request, env: Env) {
  const raw = String(request.headers.get("origin") || "").trim();
  if (!raw) return null;
  const loopback = loopbackAdminOrigin(raw);
  if (loopback) return loopback;
  const normalized = normalizeAllowedOrigin(raw);
  return normalized && configuredAdminOrigins(env).includes(normalized)
    ? normalized
    : false;
}

async function readBoundedResponseText(response: Response, maximumBytes: number) {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared) || Number(declared) > maximumBytes) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("response_too_large").catch(() => undefined);
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(combined);
  } catch {
    return null;
  }
}

async function sanitizedLegacyResponse(
  response: Response,
  origin: string | null,
) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    await response.body?.cancel().catch(() => undefined);
    return json(502, { ok: false, error: "invalid_internal_response" }, corsHeaders(origin));
  }
  const text = await readBoundedResponseText(response, MAX_SAFE_RESPONSE_BYTES);
  if (text === null) {
    return json(502, { ok: false, error: "response_too_large" }, corsHeaders(origin));
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
  delete payload.stack;
  delete payload.cause;
  if (response.status >= 400) delete payload.detail;

  const headers = secureHeaders(corsHeaders(origin));
  const requestId = response.headers.get("x-request-id");
  const retryAfter = response.headers.get("retry-after");
  if (requestId) headers.set("x-request-id", requestId);
  if (retryAfter && /^\d+$/.test(retryAfter)) {
    headers.set("Retry-After", retryAfter);
  }
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), {
    status: response.status,
    headers,
  });
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

function sanitizeChatPayload(value: JsonObject) {
  if (value.debug !== undefined && value.debug !== false) return null;
  if (value.botKey !== undefined) return null;
  const botId = normalizeBotId(value.botId);
  if (!botId || !Array.isArray(value.messages)) return null;
  if (value.messages.length === 0 || value.messages.length > MAX_CHAT_MESSAGES) {
    return null;
  }

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  let totalCharacters = 0;
  let userMessages = 0;
  for (const candidate of value.messages) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return null;
    }
    const message = candidate as JsonObject;
    const keys = Object.keys(message).sort();
    if (JSON.stringify(keys) !== JSON.stringify(["content", "role"])) return null;
    if (message.role !== "user" && message.role !== "assistant") return null;
    if (typeof message.content !== "string") return null;
    const content = message.content.trim();
    if (!content || content.length > MAX_CHAT_MESSAGE_CHARS) return null;
    totalCharacters += content.length;
    if (totalCharacters > MAX_TOTAL_CHAT_CHARS) return null;
    if (message.role === "user") userMessages += 1;
    messages.push({ role: message.role, content });
  }
  if (userMessages === 0) return null;
  return { botId, messages } as JsonObject;
}

function preflightHeaders(origin: string, admin: boolean) {
  return secureHeaders({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": admin
      ? "Content-Type, Authorization"
      : "Content-Type, x-bot-key",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  });
}

function chatPreflight(request: Request) {
  const raw = String(request.headers.get("origin") || "").trim();
  const origin = normalizeAllowedOrigin(raw);
  return origin
    ? new Response(null, { status: 204, headers: preflightHeaders(origin, false) })
    : json(403, { ok: false, error: "origin_not_allowed" });
}

function adminPreflight(request: Request, env: Env) {
  const decision = adminOriginDecision(request, env);
  return typeof decision === "string"
    ? new Response(null, { status: 204, headers: preflightHeaders(decision, true) })
    : json(403, { ok: false, error: "origin_not_allowed" });
}

async function handleAdmin(
  request: Request,
  env: Env,
  pathname: string,
) {
  const originDecision = adminOriginDecision(request, env);
  if (originDecision === false) {
    return json(403, { ok: false, error: "origin_not_allowed" });
  }
  const responseOrigin = typeof originDecision === "string" ? originDecision : null;
  if (!configuredAdminTokenAllowed(env.ADMIN_TOKEN)) {
    return json(
      503,
      { ok: false, error: "admin_not_configured" },
      corsHeaders(responseOrigin),
    );
  }
  if (!(await isAdminRequestAuthorized(request, env.ADMIN_TOKEN))) {
    return json(
      401,
      { ok: false, error: "unauthorized" },
      corsHeaders(responseOrigin),
    );
  }

  if (pathname === "/admin/list") {
    return sanitizedLegacyResponse(
      await legacyWorker.fetch(request, env),
      responseOrigin,
    );
  }
  if (!ADMIN_JSON_ROUTES.has(pathname)) {
    return json(
      404,
      { ok: false, error: "not_found" },
      corsHeaders(responseOrigin),
    );
  }

  const parsed = await parseJsonRoute(request, ADMIN_REQUEST_MAX_BYTES);
  if (!parsed.ok) {
    const body = await parsed.response.json().catch(() => ({
      ok: false,
      error: "invalid_request",
    }));
    return json(parsed.response.status, body as JsonObject, corsHeaders(responseOrigin));
  }
  let value = parsed.value;

  if (pathname === "/admin/upsert") {
    const sanitized = sanitizeUpsertConfig(value);
    if (!sanitized) {
      return json(
        400,
        { ok: false, error: "unsafe_bot_configuration" },
        corsHeaders(responseOrigin),
      );
    }
    value = sanitized;
  }
  if (pathname === "/admin/delete" && value.confirm !== "DELETE_BOT") {
    return json(
      400,
      { ok: false, error: "delete_confirmation_required" },
      corsHeaders(responseOrigin),
    );
  }
  if (pathname === "/admin/nuke" && value.confirm !== "DELETE_ALL_BOTS") {
    return json(
      400,
      { ok: false, error: "nuke_confirmation_required" },
      corsHeaders(responseOrigin),
    );
  }
  if (pathname === "/admin/leads/get") {
    const key = typeof value.key === "string" ? value.key.trim() : "";
    if (!/^lead:[A-Za-z0-9_-]{1,64}:\d{10,16}:[a-z0-9]{4,16}$/i.test(key)) {
      return json(
        400,
        { ok: false, error: "invalid_lead_key" },
        corsHeaders(responseOrigin),
      );
    }
  }
  if (pathname === "/admin/kb/refresh") {
    const requestedBotId = normalizeBotId(value.botId);
    if (!requestedBotId) {
      return json(
        400,
        { ok: false, error: "invalid_bot_id" },
        corsHeaders(responseOrigin),
      );
    }
    const canonical = await resolveBotId(env, requestedBotId);
    if (!canonical) {
      return json(
        404,
        { ok: false, error: "bot_not_found" },
        corsHeaders(responseOrigin),
      );
    }
    const config = parseStoredConfig(await env.BOT_CONFIG.get(`cfg:${canonical}`));
    if (!config) {
      return json(
        404,
        { ok: false, error: "bot_not_found" },
        corsHeaders(responseOrigin),
      );
    }
    const summary = await refreshBotKnowledge(env, config);
    return summary === null
      ? json(
          409,
          { ok: false, error: "unsafe_bot_configuration" },
          corsHeaders(responseOrigin),
        )
      : json(200, { ok: true, ...summary }, corsHeaders(responseOrigin));
  }

  const forwarded = rebuildJsonRequest(request, value, true);
  return sanitizedLegacyResponse(
    await legacyWorker.fetch(forwarded, env),
    responseOrigin,
  );
}

async function handleChat(request: Request, env: Env) {
  const parsed = await parseJsonRoute(request, CHAT_REQUEST_MAX_BYTES);
  if (!parsed.ok) return parsed.response;
  const value = sanitizeChatPayload(parsed.value);
  if (!value) {
    return json(400, { ok: false, error: "invalid_chat_request" });
  }

  const requestedBotId = value.botId as string;
  const canonical = await resolveBotId(env, requestedBotId);
  if (!canonical) return json(404, { ok: false, error: "bot_not_found" });
  const config = parseStoredConfig(await env.BOT_CONFIG.get(`cfg:${canonical}`));
  if (!config) return json(404, { ok: false, error: "bot_not_found" });
  const network = safeStoredNetworkConfig(config);
  if (!network) return json(409, { ok: false, error: "unsafe_bot_configuration" });

  const originDecision = browserOriginDecision(request, network.origins);
  if (originDecision === false) {
    return json(403, { ok: false, error: "origin_not_allowed" });
  }
  const responseOrigin = typeof originDecision === "string" ? originDecision : null;
  if (originDecision === null) {
    const providedBotKey = String(request.headers.get("x-bot-key") || "").trim();
    const authorized = await boundedSecretEqual(
      providedBotKey,
      network.botKey,
      BOT_KEY_MIN_BYTES,
      BOT_KEY_MAX_BYTES,
    );
    if (!authorized) {
      return json(401, { ok: false, error: "bot_key_required" });
    }
  }

  const safeConfig = await buildSafeChatConfig(env, config, network, value);
  const safeEnv = withBotConfigOverride(env, canonical, safeConfig) as Env;
  const forwarded = rebuildJsonRequest(
    request,
    {
      botId: canonical,
      messages: value.messages,
      debug: false,
    },
    false,
  );
  return sanitizedLegacyResponse(
    await legacyWorker.fetch(forwarded, safeEnv),
    responseOrigin,
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      if (request.method === "OPTIONS") {
        if (pathname === "/api/chat") return chatPreflight(request);
        if (pathname.startsWith(ADMIN_PREFIX)) return adminPreflight(request, env);
        return json(
          405,
          { ok: false, error: "method_not_allowed" },
          { Allow: "GET, POST" },
        );
      }

      if (pathname === "/health") {
        if (request.method !== "GET") {
          return json(
            405,
            { ok: false, error: "method_not_allowed" },
            { Allow: "GET" },
          );
        }
        return json(200, {
          ok: true,
          service: "EVAVO Client Chat Platform",
          securityContract: "client_chat_hardened_router_v2",
          adminRoutesProtected: true,
          boundedChatRequests: true,
          publicDebugOutput: false,
          publicChatNetworkFetch: false,
          externalWebhookExecution: false,
        });
      }

      if (pathname.startsWith(ADMIN_PREFIX)) {
        if (request.method !== "POST") {
          return json(
            405,
            { ok: false, error: "method_not_allowed" },
            { Allow: "POST" },
          );
        }
        return await handleAdmin(request, env, pathname);
      }

      if (pathname === "/api/chat") {
        if (request.method !== "POST") {
          return json(
            405,
            { ok: false, error: "method_not_allowed" },
            { Allow: "POST" },
          );
        }
        return await handleChat(request, env);
      }

      return json(404, { ok: false, error: "not_found" });
    } catch {
      return json(500, { ok: false, error: "internal_error" });
    }
  },
};

export const hardenedChatPlatformPosture = Object.freeze({
  contract: "client_chat_hardened_router_v2",
  legacyRouterWrapped: true,
  legacyRouterDirectlyDeployed: false,
  boundedAdminJsonBytes: ADMIN_REQUEST_MAX_BYTES,
  boundedChatJsonBytes: CHAT_REQUEST_MAX_BYTES,
  boundedInternalResponses: true,
  exactBearerAdminAuthentication: true,
  legacyAdminHeaderAllowed: false,
  browserAdminOriginsRestricted: true,
  localAdminOriginDevelopmentException: true,
  publicHealthLeaksAdminConfiguration: false,
  browserOriginsDefaultAllow: false,
  wildcardBrowserOriginsAllowed: false,
  serverChatWithoutBotKeyAllowed: false,
  botKeyComparedAtHardenedBoundary: true,
  botKeyAcceptedInJsonBody: false,
  publicDebugOutputAllowed: false,
  publicChatNetworkFetchAllowed: false,
  cachedKnowledgeOnlyForPublicChat: true,
  adminRefreshNetworkOnly: true,
  legacyExternalWebhookExecutionAllowed: false,
  leadCaptureAllowed: true,
  destructiveAdminConfirmationRequired: true,
  rawProviderErrorsExposed: false,
  unexpectedErrorsSanitized: true,
});