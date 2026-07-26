import hardenedWorker, { type Env as HardenedEnv } from "./hardened";

export interface Env extends HardenedEnv {}

export const ACTIVE_CHAT_RUNTIME_CONTRACT =
  "client_chat_active_runtime_v1" as const;

const DEFAULT_CHAT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const RETIRED_CHAT_MODELS = new Set([
  "@cf/meta/llama-3-8b-instruct",
]);
const MODEL_PATTERN = /^@cf\/[A-Za-z0-9._/-]{1,120}$/;
const LEGACY_ADMIN_HEADER = "x-admin-token";

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
        return (model: unknown, ...args: unknown[]) =>
          value.call(current, effectiveChatModel(model), ...args);
      }
      return typeof value === "function" ? value.bind(current) : value;
    },
  }) as Env["AI"];
}

function runtimeEnvironment(env: Env): Env {
  return {
    ...env,
    AI: withModelBoundary(env.AI),
  };
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
    const response = await hardenedWorker.fetch(
      sanitizedRequest,
      runtimeEnvironment(env),
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
  missingModelUsesReviewedFallback: true,
  malformedModelUsesReviewedFallback: true,
  retiredModelUsesReviewedFallback: true,
  reviewedFallbackModel: DEFAULT_CHAT_MODEL,
  rawModelConfigurationExposedInRuntimeHeaders: false,
});
