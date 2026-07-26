import hardenedWorker, { type Env as HardenedEnv } from "./hardened";
import {
  handleExplicitLeadCapture,
  leadCapturePreflight,
} from "./leadCapture";
import {
  redactAdminConfigResponse,
  withHashedLegacyRateLimitKeys,
  withProtectedBotConfigWrites,
} from "./runtimeStorageBoundary";

export interface Env extends HardenedEnv {}

export const ACTIVE_CHAT_RUNTIME_CONTRACT =
  "client_chat_active_runtime_v2" as const;

const DEFAULT_CHAT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const RETIRED_CHAT_MODELS = new Set([
  "@cf/meta/llama-3-8b-instruct",
]);
const MODEL_PATTERN = /^@cf\/[A-Za-z0-9._/-]{1,120}$/;
const MODEL_TIMEOUT_MS = 20_000;
const LEGACY_ADMIN_HEADER = "x-admin-token";
const CHAT_ROUTE = "/api/chat";
const LEAD_ROUTE = "/api/leads";
const ADMIN_UPSERT_ROUTE = "/admin/upsert";

function effectiveChatModel(value: unknown) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (
    !candidate ||
    !MODEL_PATTERN.test(candidate) ||
    RETIRED_CHAT_MODELS.has(candidate)
  ) {
    return DEFAULT_CHAT_MODEL;
  }
  return candidate;
}

function withoutLegacyAdminHeader(request: Request) {
  if (!request.headers.has(LEGACY_ADMIN_HEADER)) return request;
  const headers = new Headers(request.headers);
  headers.delete(LEGACY_ADMIN_HEADER);
  return new Request(request, { headers });
}

function withModelBoundary(ai: Env["AI"]): Env["AI"] {
  if (!ai || (typeof ai !== "object" && typeof ai !== "function")) return ai;
  const target = ai as object;
  return new Proxy(target, {
    get(current, property) {
      const value = Reflect.get(current, property, current);
      if (property === "run" && typeof value === "function") {
        return async (model: unknown, ...args: unknown[]) => {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          const timedOut = new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error("model_timeout")),
              MODEL_TIMEOUT_MS,
            );
          });
          try {
            return await Promise.race([
              Promise.resolve(
                value.call(current, effectiveChatModel(model), ...args),
              ),
              timedOut,
            ]);
          } finally {
            if (timeout !== undefined) clearTimeout(timeout);
          }
        };
      }
      return typeof value === "function" ? value.bind(current) : value;
    },
  }) as Env["AI"];
}

function withoutImplicitLeadAccess(binding: KVNamespace) {
  const target = binding;
  return new Proxy(target, {
    get(current, property, receiver) {
      const value = Reflect.get(current, property, receiver);
      if (property === "get" && typeof value === "function") {
        return async (key: string, ...args: unknown[]) => {
          if (typeof key === "string" && key.startsWith("lead:")) {
            return key.startsWith("lead:index:") ? "[]" : null;
          }
          return value.call(current, key, ...args);
        };
      }
      if (
        (property === "put" || property === "delete") &&
        typeof value === "function"
      ) {
        return async (key: string, ...args: unknown[]) => {
          if (typeof key === "string" && key.startsWith("lead:")) return;
          return value.call(current, key, ...args);
        };
      }
      return typeof value === "function" ? value.bind(current) : value;
    },
  }) as KVNamespace;
}

function runtimeEnvironment(env: Env, pathname: string): Env {
  const chatRequest = pathname === CHAT_ROUTE;
  const configWrite = pathname === ADMIN_UPSERT_ROUTE;
  return {
    ...env,
    AI: withModelBoundary(env.AI),
    BOT_CONFIG: chatRequest
      ? withoutImplicitLeadAccess(env.BOT_CONFIG)
      : configWrite
        ? withProtectedBotConfigWrites(env.BOT_CONFIG)
        : env.BOT_CONFIG,
    KB_CACHE: chatRequest
      ? withHashedLegacyRateLimitKeys(env.KB_CACHE)
      : env.KB_CACHE,
  };
}

function runtimeJson(status: number, body: Record<string, unknown>, allow: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      Allow: allow,
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "application/json; charset=utf-8",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}

function stampRuntimeContract(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("X-EVAVO-Chat-Runtime", ACTIVE_CHAT_RUNTIME_CONTRACT);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const sanitizedRequest = withoutLegacyAdminHeader(request);
    const pathname = new URL(sanitizedRequest.url).pathname;

    if (pathname === LEAD_ROUTE) {
      if (sanitizedRequest.method === "OPTIONS") {
        return stampRuntimeContract(leadCapturePreflight(sanitizedRequest));
      }
      if (sanitizedRequest.method !== "POST") {
        return stampRuntimeContract(
          runtimeJson(
            405,
            { ok: false, error: "method_not_allowed" },
            "POST",
          ),
        );
      }
      return stampRuntimeContract(
        await handleExplicitLeadCapture(sanitizedRequest, env),
      );
    }

    const sanitizedEnvironment = runtimeEnvironment(env, pathname);
    const routedResponse = await hardenedWorker.fetch(
      sanitizedRequest,
      sanitizedEnvironment,
    );
    const response = await redactAdminConfigResponse(
      routedResponse,
      pathname,
    );
    return stampRuntimeContract(response);
  },
};

export const activeChatRuntimePosture = Object.freeze({
  contract: ACTIVE_CHAT_RUNTIME_CONTRACT,
  hardenedRouterWrapped: true,
  legacyRouterDirectlyDeployed: false,
  legacyAdminHeaderRemovedBeforeRouting: true,
  exactBearerAuthenticationRemainsRequired: true,
  configuredModelValidatedBeforeProviderCall: true,
  modelResponseTimeoutMs: MODEL_TIMEOUT_MS,
  missingModelUsesReviewedFallback: true,
  malformedModelUsesReviewedFallback: true,
  retiredModelUsesReviewedFallback: true,
  reviewedFallbackModel: DEFAULT_CHAT_MODEL,
  implicitModelLeadStorageAllowed: false,
  implicitModelLeadIndexReadsAllowed: false,
  explicitVisitorLeadConsentRequired: true,
  explicitLeadRoute: LEAD_ROUTE,
  rawModelConfigurationExposedInRuntimeHeaders: false,
  rawBotKeyReturnedByAdminConfigRoutes: false,
  blankBotKeyUpdateClearsExistingKey: false,
  retiredWebhookCredentialsReturned: false,
  rawClientAddressStoredInLegacyRateLimitKey: false,
});
