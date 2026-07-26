import type { Env } from "./index";
import {
  fetchBoundedPublicText,
  normalizeAllowedOrigin,
  normalizePublicHttpsUrl,
} from "./security";

export const BOT_CONFIG_BOUNDARY_CONTRACT =
  "client_chat_bot_config_boundary_v1" as const;

export type JsonObject = Record<string, unknown>;
export type StoredBotConfig = JsonObject & {
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

const BOT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BOT_KEY_MIN_LENGTH = 16;
const BOT_KEY_MAX_LENGTH = 256;
const URL_MAX_LENGTH = 2_048;
const ORIGIN_MAX_LENGTH = 512;
const CONTACT_URL_MAX_LENGTH = 512;
const MAX_KNOWLEDGE_URLS = 50;
const MAX_ALLOWED_ORIGINS = 25;
const MAX_REFRESH_URLS = 20;
const MAX_CURATED_KNOWLEDGE_CHARS = 200_000;
const MAX_CACHE_TEXT_CHARS = 20_000;
const MAX_INJECTED_CACHE_CHARS = 60_000;
const SAFE_ACTION_TYPES = new Set(["open_contact", "create_lead", "none"]);

export function normalizeBotId(value: unknown) {
  const candidate = typeof value === "string" ? value.trim() : "";
  return BOT_ID_PATTERN.test(candidate) ? candidate : null;
}

export function parseStoredConfig(raw: string | null): StoredBotConfig | null {
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
  if (candidate.length > CONTACT_URL_MAX_LENGTH) return null;
  if (
    candidate.startsWith("/") &&
    !candidate.startsWith("//") &&
    !candidate.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return candidate;
  }
  return normalizePublicHttpsUrl(candidate);
}

function normalizeAllowedOrigins(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_ALLOWED_ORIGINS
  ) {
    return null;
  }
  const origins: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length > ORIGIN_MAX_LENGTH) {
      return null;
    }
    const normalized = normalizeAllowedOrigin(item);
    if (!normalized) return null;
    origins.push(normalized);
  }
  return Array.from(new Set(origins));
}

function normalizeKnowledgeUrls(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_KNOWLEDGE_URLS) return null;
  const urls: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length > URL_MAX_LENGTH) {
      return null;
    }
    const normalized = normalizePublicHttpsUrl(item);
    if (!normalized) return null;
    urls.push(normalized);
  }
  return Array.from(new Set(urls));
}

function normalizeBotKey(value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (
    candidate.length < BOT_KEY_MIN_LENGTH ||
    candidate.length > BOT_KEY_MAX_LENGTH ||
    /[\s\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function normalizeActions(value: unknown) {
  if (value === undefined) {
    return {
      actionsEnabled: false,
      allowedActionTypes: ["none"],
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as JsonObject;
  if (source.webhookUrl || source.webhookAuthHeader || source.webhookSecret) {
    return null;
  }
  const supplied = Array.isArray(source.allowedActionTypes)
    ? source.allowedActionTypes
    : ["none"];
  const allowed = supplied.filter(
    (item): item is string => typeof item === "string" && SAFE_ACTION_TYPES.has(item),
  );
  if (allowed.length !== supplied.length) return null;
  const unique = Array.from(new Set(allowed));
  return {
    actionsEnabled: source.actionsEnabled === true,
    allowedActionTypes: unique.length ? unique : ["none"],
  };
}

export function sanitizeUpsertConfig(value: JsonObject) {
  const botId = normalizeBotId(value.botId);
  const allowedOrigins = normalizeAllowedOrigins(value.allowedOrigins);
  const knowledgeUrls = normalizeKnowledgeUrls(value.knowledgeUrls);
  const contactUrl = normalizeContactUrl(value.contactUrl);
  const botKey = normalizeBotKey(value.botKey);
  const actions = normalizeActions(value.actions);
  if (
    !botId ||
    !allowedOrigins ||
    knowledgeUrls === null ||
    !contactUrl ||
    botKey === null ||
    actions === null
  ) {
    return null;
  }
  if (
    value.model !== undefined &&
    (typeof value.model !== "string" ||
      !/^@cf\/[A-Za-z0-9._/-]{1,120}$/.test(value.model.trim()))
  ) {
    return null;
  }

  return {
    ...value,
    botId,
    allowedOrigins,
    knowledgeUrls,
    contactUrl,
    botKey,
    actions,
    debug: undefined,
  } as JsonObject;
}

export function safeStoredNetworkConfig(config: StoredBotConfig) {
  const origins = normalizeAllowedOrigins(config.allowedOrigins);
  const knowledgeUrls = normalizeKnowledgeUrls(config.knowledgeUrls);
  const contactUrl = normalizeContactUrl(config.contactUrl);
  const botKey = normalizeBotKey(config.botKey);
  const actions = normalizeActions(config.actions);
  return origins && knowledgeUrls !== null && contactUrl && botKey !== null && actions
    ? { origins, knowledgeUrls, contactUrl, botKey, actions }
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

export function browserOriginDecision(
  request: Request,
  origins: readonly string[],
) {
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

export async function resolveBotId(env: Env, requested: string) {
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

function relevantKnowledgeUrls(
  question: string,
  urls: readonly string[],
  maximum: number,
) {
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

function latestUserQuestion(body: JsonObject) {
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
  return typeof latestUser?.content === "string" ? latestUser.content : "";
}

export async function buildSafeChatConfig(
  env: Env,
  config: StoredBotConfig,
  network: NonNullable<ReturnType<typeof safeStoredNetworkConfig>>,
  body: JsonObject,
) {
  const maximumUrls = Math.max(
    0,
    Math.min(
      3,
      Number.isFinite(Number(config.ragMaxUrlsPerRequest))
        ? Math.trunc(Number(config.ragMaxUrlsPerRequest))
        : 2,
    ),
  );
  const cachedSources: string[] = [];
  if (config.ragEnabled === true && maximumUrls > 0) {
    for (const url of relevantKnowledgeUrls(
      latestUserQuestion(body),
      network.knowledgeUrls,
      maximumUrls,
    )) {
      let cached: string | null = null;
      try {
        cached = await env.KB_CACHE.get(`kb:${url}`);
      } catch {
        cached = null;
      }
      const text = String(cached || "").trim().slice(0, MAX_CACHE_TEXT_CHARS);
      if (text) cachedSources.push(`Source: ${url}\n${text}`);
      if (cachedSources.join("\n\n").length >= MAX_INJECTED_CACHE_CHARS) break;
    }
  }

  const curatedKnowledge =
    typeof config.knowledge === "string"
      ? config.knowledge.slice(0, MAX_CURATED_KNOWLEDGE_CHARS)
      : "";
  const cachedKnowledge = cachedSources
    .join("\n\n")
    .slice(0, MAX_INJECTED_CACHE_CHARS);

  return {
    ...config,
    allowedOrigins: network.origins,
    contactUrl: network.contactUrl,
    botKey: network.botKey,
    knowledge: [curatedKnowledge, cachedKnowledge].filter(Boolean).join("\n\n"),
    knowledgeUrls: [],
    ragEnabled: false,
    actions: network.actions,
  } as JsonObject;
}

export function withBotConfigOverride(
  env: Env,
  canonicalBotId: string,
  config: JsonObject,
) {
  const binding = new Proxy(env.BOT_CONFIG, {
    get(target, property, receiver) {
      if (property === "get") {
        return async (key: string, ...args: unknown[]) => {
          if (key === `cfg:${canonicalBotId}`) return JSON.stringify(config);
          const getter = target.get as (...values: unknown[]) => unknown;
          return getter.call(target, key, ...args);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as KVNamespace;
  return { ...env, BOT_CONFIG: binding } as Env;
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

export async function refreshBotKnowledge(env: Env, config: StoredBotConfig) {
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
  for (const url of network.knowledgeUrls.slice(0, MAX_REFRESH_URLS)) {
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

export const botConfigBoundaryPosture = Object.freeze({
  allowedOriginsRequired: true,
  openByDefaultBrowserOrigins: false,
  sharedHostingWildcardOriginsAllowed: false,
  publicHttpsKnowledgeUrlsOnly: true,
  knowledgeUrlMaximumLength: URL_MAX_LENGTH,
  liveRagFetchFromPublicChatAllowed: false,
  adminRefreshNetworkOnly: true,
  cachedChatKnowledgeOnly: true,
  legacyWebhookConfigurationAllowed: false,
  safeActionTypes: ["open_contact", "create_lead", "none"] as const,
  omittedActionsPreserveLegacyWebhook: false,
  omittedKnowledgeUrlsPreserveUnsafeUrls: false,
  botKeyMinimumLengthWhenConfigured: BOT_KEY_MIN_LENGTH,
});
