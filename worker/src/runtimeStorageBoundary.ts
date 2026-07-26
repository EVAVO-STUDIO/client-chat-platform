import { sha256Hex } from "./security";

export const RUNTIME_STORAGE_BOUNDARY_CONTRACT =
  "client_chat_runtime_storage_boundary_v1" as const;

export const BOT_KEY_CLEAR_SENTINEL = "__EVAVO_CLEAR_BOT_KEY__";

const BOT_CONFIG_PREFIX = "cfg:";
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
  return JSON.stringify(scrubbed);
}

export function withProtectedBotConfigWrites(binding: KVNamespace) {
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
          if (
            typeof key !== "string" ||
            !key.startsWith(BOT_CONFIG_PREFIX) ||
            typeof payload !== "string"
          ) {
            return current.put(key, payload, options);
          }
          const protectedValue = await protectedConfigValue(
            current,
            key,
            payload,
          );
          return current.put(key, protectedValue, options);
        };
      }
      return typeof value === "function" ? value.bind(current) : value;
    },
  }) as KVNamespace;
}

async function privacySafeRateLimitKey(key: string) {
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

function projectAdminConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as JsonObject;
  const projected = scrubRetiredConfigSecrets(source);
  projected.botKeyConfigured = botKeyAllowed(source.botKey);
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
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : { ok: false, error: "invalid_internal_response" };
  } catch {
    payload = { ok: false, error: "invalid_internal_response" };
  }

  if (payload.cfg !== undefined) {
    payload.cfg = projectAdminConfig(payload.cfg);
  }
  payload.configSecretsRedacted = true;
  return replacementResponse(response, response.status, payload);
}

export const runtimeStorageBoundaryPosture = Object.freeze({
  contract: RUNTIME_STORAGE_BOUNDARY_CONTRACT,
  rawBotKeyReturnedByAdminConfigRoutes: false,
  blankBotKeyUpdateClearsExistingKey: false,
  explicitBotKeyClearSentinelRequired: true,
  retiredWebhookCredentialsReturned: false,
  retiredWebhookCredentialsPersistedOnUpsert: false,
  rawClientAddressStoredInLegacyRateLimitKey: false,
  hashedLegacyRateLimitKeyPrefix: HASHED_RATE_LIMIT_PREFIX,
  rateLimitIdentifierPseudonymousNotAnonymous: true,
  responseBodiesBoundedBeforeProjection: true,
});
