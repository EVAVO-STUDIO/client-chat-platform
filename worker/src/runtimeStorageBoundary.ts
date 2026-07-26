import { sha256Hex } from "./security";

export const RUNTIME_STORAGE_BOUNDARY_CONTRACT =
  "client_chat_runtime_storage_boundary_v4" as const;

export const BOT_KEY_CLEAR_SENTINEL = "__EVAVO_CLEAR_BOT_KEY__";

const BOT_CONFIG_PREFIX = "cfg:";
const BOT_CONFIG_INDEX_KEY = "cfg:index";
const BOT_CONFIG_KEY_PATTERN = /^cfg:[A-Za-z0-9_-]{1,64}$/;
const BOT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const LEGACY_RATE_LIMIT_PREFIX = "rl:";
const HASHED_RATE_LIMIT_PREFIX = "rl:v2:";
const MAX_ADMIN_RESPONSE_BYTES = 512 * 1024;
const BOT_KEY_MIN_BYTES = 16;
const BOT_KEY_MAX_BYTES = 256;
const SAFE_ACTION_TYPES = new Set(["open_contact", "create_lead", "none"]);
const CONFIG_RESPONSE_PATHS = new Set(["/admin/get", "/admin/upsert"]);
const RETIRED_SECRET_FIELDS = [
  "authorization",
  "botKey",
  "password",
  "secret",
  "token",
  "webhookAuthHeader",
  "webhookSecret",
  "webhookUrl",
] as const;

type JsonObject = Record<string, unknown>;

export type BotConfigMutationReceipt = {
  botId: string | null;
  botKeyConfigured: boolean | null;
  committed: boolean;
};

export function createBotConfigMutationReceipt(): BotConfigMutationReceipt {
  return {
    botId: null,
    botKeyConfigured: null,
    committed: false,
  };
}

function parseJsonObject(value: unknown): JsonObject | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : null;
  } catch {
    return null;
  }
}

function botKeyAllowed(value: unknown): value is string {
  if (typeof value !== "string" || !value || /\s/.test(value)) return false;
  const bytes = new TextEncoder().encode(value).byteLength;
  return bytes >= BOT_KEY_MIN_BYTES && bytes <= BOT_KEY_MAX_BYTES;
}

function projectedActions(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { actionsEnabled: false, allowedActionTypes: ["none"] };
  }
  const source = value as JsonObject;
  const supplied = Array.isArray(source.allowedActionTypes)
    ? source.allowedActionTypes
    : [];
  const allowed = Array.from(
    new Set(
      supplied.filter(
        (item): item is string =>
          typeof item === "string" && SAFE_ACTION_TYPES.has(item),
      ),
    ),
  );
  return {
    actionsEnabled: source.actionsEnabled === true,
    allowedActionTypes: allowed.length ? allowed : ["none"],
  };
}

function scrubRetiredConfigSecrets(config: JsonObject) {
  const next: JsonObject = { ...config };
  for (const field of RETIRED_SECRET_FIELDS) {
    if (field !== "botKey") delete next[field];
  }
  next.actions = projectedActions(next.actions);
  return next;
}

async function protectedConfigValue(
  binding: KVNamespace,
  key: string,
  value: string,
) {
  const next = parseJsonObject(value);
  if (!next) throw new Error("invalid_bot_configuration_write");
  const botId = key.slice(BOT_CONFIG_PREFIX.length);
  if (!BOT_ID_PATTERN.test(botId)) {
    throw new Error("invalid_bot_configuration_write");
  }

  const requestedBotKey =
    typeof next.botKey === "string" ? next.botKey : "";
  if (requestedBotKey === BOT_KEY_CLEAR_SENTINEL) {
    next.botKey = "";
  } else if (!requestedBotKey) {
    const current = parseJsonObject(await binding.get(key));
    next.botKey = botKeyAllowed(current?.botKey) ? current.botKey : "";
  } else if (!botKeyAllowed(requestedBotKey)) {
    throw new Error("invalid_bot_key_write");
  }

  const scrubbed = scrubRetiredConfigSecrets(next);
  scrubbed.botKey = next.botKey;
  return {
    botId,
    botKeyConfigured: botKeyAllowed(scrubbed.botKey),
    serialized: JSON.stringify(scrubbed),
  } as const;
}

export function withProtectedBotConfigWrites(
  binding: KVNamespace,
  receipt?: BotConfigMutationReceipt,
) {
  const target = binding;
  return new Proxy(target, {
    get(current, property, receiver) {
      const value = Reflect.get(current, property, receiver);
      if (property === "put" && typeof value === "function") {
        return async (
          key: string,
          payload: string | ArrayBuffer | ArrayBufferView | ReadableStream,
          options?: KVNamespacePutOptions,
        ) => {
          if (typeof key !== "string" || !key.startsWith(BOT_CONFIG_PREFIX)) {
            return current.put(key, payload, options);
          }
          if (key === BOT_CONFIG_INDEX_KEY) {
            return current.put(key, payload, options);
          }
          if (!BOT_CONFIG_KEY_PATTERN.test(key) || typeof payload !== "string") {
            throw new Error("invalid_bot_configuration_write");
          }
          const protectedValue = await protectedConfigValue(
            current,
            key,
            payload,
          );
          await current.put(key, protectedValue.serialized, options);
          if (receipt) {
            receipt.botId = protectedValue.botId;
            receipt.botKeyConfigured = protectedValue.botKeyConfigured;
            receipt.committed = true;
          }
        };
      }
      return typeof value === "function" ? value.bind(current) : value;
    },
  }) as KVNamespace;
}

async function privacySafeRateLimitKey(key: string) {
  if (key.startsWith(HASHED_RATE_LIMIT_PREFIX)) return key;
  if (!key.startsWith(LEGACY_RATE_LIMIT_PREFIX)) return key;
  return `${HASHED_RATE_LIMIT_PREFIX}${await sha256Hex(
    `client-chat-rate-limit\u0000${key}`,
  )}`;
}

export function withHashedLegacyRateLimitKeys(binding: KVNamespace) {
  const target = binding;
  return new Proxy(target, {
    get(current, property, receiver) {
      const value = Reflect.get(current, property, receiver);
      if (property === "get" && typeof value === "function") {
        return async (key: string, ...args: unknown[]) =>
          (current.get as (...values: unknown[]) => unknown).call(
            current,
            await privacySafeRateLimitKey(String(key)),
            ...args,
          );
      }
      if (property === "put" && typeof value === "function") {
        return async (key: string, ...args: unknown[]) =>
          (current.put as (...values: unknown[]) => unknown).call(
            current,
            await privacySafeRateLimitKey(String(key)),
            ...args,
          );
      }
      if (property === "delete" && typeof value === "function") {
        return async (key: string, ...args: unknown[]) =>
          (current.delete as (...values: unknown[]) => unknown).call(
            current,
            await privacySafeRateLimitKey(String(key)),
            ...args,
          );
      }
      return typeof value === "function" ? value.bind(current) : value;
    },
  }) as KVNamespace;
}

function responseBotId(responseConfig: JsonObject) {
  const candidate = typeof responseConfig.botId === "string"
    ? responseConfig.botId.trim()
    : "";
  return BOT_ID_PATTERN.test(candidate) ? candidate : null;
}

function botKeyProjectionStatus(
  responseConfig: JsonObject,
  pathname: string,
  receipt?: BotConfigMutationReceipt,
): boolean | null {
  const botId = responseBotId(responseConfig);
  if (
    pathname === "/admin/upsert" &&
    receipt?.committed === true &&
    botId !== null &&
    receipt.botId === botId
  ) {
    return receipt.botKeyConfigured;
  }
  if (responseConfig.botKey === BOT_KEY_CLEAR_SENTINEL) return false;
  if (botKeyAllowed(responseConfig.botKey)) return true;
  return pathname === "/admin/get" ? false : null;
}

function projectAdminConfig(
  value: unknown,
  pathname: string,
  receipt?: BotConfigMutationReceipt,
): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as JsonObject;
  const projected = scrubRetiredConfigSecrets(source);
  const configured = botKeyProjectionStatus(source, pathname, receipt);
  projected.botKeyConfigured = configured;
  projected.botKeyStatus = configured === true
    ? "configured"
    : configured === false
      ? "not_configured"
      : "unknown";
  delete projected.botKey;
  return projected;
}

async function readBoundedResponseText(
  response: Response,
  maximumBytes: number,
) {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)
  ) {
    await response.body?.cancel().catch(() => undefined);
    return null;
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

function replacementResponse(
  source: Response,
  status: number,
  payload: JsonObject,
) {
  const headers = new Headers(source.headers);
  headers.delete("content-length");
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(JSON.stringify(payload), { status, headers });
}

export async function redactAdminConfigResponse(
  response: Response,
  pathname: string,
  receipt?: BotConfigMutationReceipt,
) {
  if (!CONFIG_RESPONSE_PATHS.has(pathname)) return response;
  const contentType = String(
    response.headers.get("content-type") || "",
  ).toLowerCase();
  if (!contentType.includes("application/json")) {
    await response.body?.cancel().catch(() => undefined);
    return replacementResponse(response, 502, {
      ok: false,
      error: "invalid_internal_response",
    });
  }

  const source = await readBoundedResponseText(
    response,
    MAX_ADMIN_RESPONSE_BYTES,
  );
  if (source === null) {
    return replacementResponse(response, 502, {
      ok: false,
      error: "invalid_internal_response",
    });
  }

  let payload: JsonObject;
  try {
    const parsed = JSON.parse(source) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return replacementResponse(response, 502, {
        ok: false,
        error: "invalid_internal_response",
      });
    }
    payload = parsed as JsonObject;
  } catch {
    return replacementResponse(response, 502, {
      ok: false,
      error: "invalid_internal_response",
    });
  }

  if (payload.cfg !== undefined) {
    const projected = projectAdminConfig(
      payload.cfg,
      pathname,
      receipt,
    );
    if (!projected) {
      return replacementResponse(response, 502, {
        ok: false,
        error: "invalid_internal_response",
      });
    }
    payload.cfg = projected;
  }
  payload.configSecretsRedacted = true;
  return replacementResponse(response, response.status, payload);
}

export const runtimeStorageBoundaryPosture = Object.freeze({
  contract: RUNTIME_STORAGE_BOUNDARY_CONTRACT,
  botConfigIndexBypassesObjectProjection: true,
  malformedConfigKeysRejected: true,
  rawBotKeyReturnedByAdminConfigRoutes: false,
  blankBotKeyUpdateClearsExistingKey: false,
  explicitBotKeyClearSentinelRequired: true,
  upsertBotKeyStatusUsesCommittedMutationReceipt: true,
  postWriteKvReadRequiredForUpsertStatus: false,
  unknownBotKeyStatusAllowedWithoutReceipt: true,
  retiredWebhookCredentialsReturned: false,
  retiredWebhookCredentialsPersistedOnUpsert: false,
  rawClientAddressStoredInLegacyRateLimitKey: false,
  alreadyHashedRateLimitKeysRehashed: false,
  hashedLegacyRateLimitKeyPrefix: HASHED_RATE_LIMIT_PREFIX,
  rateLimitIdentifierPseudonymousNotAnonymous: true,
  responseBodiesBoundedBeforeProjection: true,
  invalidJsonAdminResponseAccepted: false,
});
