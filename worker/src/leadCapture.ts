import type { Env as LegacyEnv } from "./index";
import {
  browserOriginDecision,
  normalizeBotId,
  parseStoredConfig,
  resolveBotId,
  safeStoredNetworkConfig,
  type JsonObject,
} from "./configBoundary";
import {
  normalizeAllowedOrigin,
  readBoundedJsonObject,
  sha256Hex,
} from "./security";

export const EXPLICIT_LEAD_CAPTURE_CONTRACT =
  "client_chat_explicit_lead_capture_v1" as const;

export type LeadCaptureEnv = Pick<LegacyEnv, "BOT_CONFIG" | "KB_CACHE">;

const LEAD_REQUEST_MAX_BYTES = 32 * 1024;
const LEAD_RATE_LIMIT = 3;
const LEAD_RATE_WINDOW_SECONDS = 10 * 60;
const LEAD_INDEX_MAXIMUM = 500;
const LEAD_CONSENT_VERSION = "visitor_follow_up_consent_v1";
const TOP_LEVEL_FIELDS = ["botId", "consent", "lead"];
const LEAD_FIELDS = new Set([
  "company",
  "email",
  "message",
  "name",
  "phone",
  "sourcePath",
]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LEAD_KEY_PATTERN = /^lead:[A-Za-z0-9_-]{1,64}:\d{10,16}:[a-z0-9]{4,16}$/i;

function secureHeaders(initial?: HeadersInit) {
  const headers = new Headers(initial);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return headers;
}

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  } as const;
}

function json(
  status: number,
  body: JsonObject,
  origin?: string,
  additionalHeaders?: HeadersInit,
) {
  const headers = secureHeaders(additionalHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function exactObjectFields(value: JsonObject, expected: readonly string[]) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
  options: Readonly<{ multiline?: boolean; required?: boolean }> = {},
) {
  if (value === undefined || value === null || value === "") {
    return options.required ? null : undefined;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < minimum || text.length > maximum) return null;
  const controlPattern = options.multiline
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
    : /[\u0000-\u001f\u007f]/;
  return controlPattern.test(text) ? null : text;
}

function safeSourcePath(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (
    path.length === 0 ||
    path.length > 512 ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    return null;
  }
  return path;
}

function sanitizeLeadRequest(value: JsonObject) {
  if (!exactObjectFields(value, TOP_LEVEL_FIELDS)) return null;
  const botId = normalizeBotId(value.botId);
  if (!botId || value.consent !== true) return null;
  if (!value.lead || typeof value.lead !== "object" || Array.isArray(value.lead)) {
    return null;
  }
  const lead = value.lead as JsonObject;
  for (const field of Object.keys(lead)) {
    if (!LEAD_FIELDS.has(field)) return null;
  }

  const email = boundedText(lead.email, 3, 320, { required: true });
  const message = boundedText(lead.message, 10, 2_000, {
    multiline: true,
    required: true,
  });
  const name = boundedText(lead.name, 1, 120);
  const company = boundedText(lead.company, 1, 160);
  const phone = boundedText(lead.phone, 7, 40);
  const sourcePath = safeSourcePath(lead.sourcePath);
  if (
    email === null ||
    message === null ||
    name === null ||
    company === null ||
    phone === null ||
    sourcePath === null ||
    !EMAIL_PATTERN.test(email)
  ) {
    return null;
  }
  if (phone && phone.replace(/\D/g, "").length < 6) return null;

  return {
    botId,
    lead: {
      ...(name ? { name } : {}),
      email: email.toLowerCase(),
      ...(phone ? { phone } : {}),
      ...(company ? { company } : {}),
      message,
      ...(sourcePath ? { sourcePath } : {}),
    },
  } as const;
}

function requestOrigin(request: Request) {
  const raw = String(request.headers.get("origin") || "").trim();
  return normalizeAllowedOrigin(raw);
}

function clientAddress(request: Request) {
  const cloudflare = String(request.headers.get("cf-connecting-ip") || "").trim();
  if (cloudflare) return cloudflare.slice(0, 128);
  return String(request.headers.get("x-forwarded-for") || "")
    .split(",", 1)[0]
    .trim()
    .slice(0, 128) || "unknown";
}

async function consumeLeadRateLimit(
  env: LeadCaptureEnv,
  request: Request,
  botId: string,
  origin: string,
) {
  const bucket = Math.floor(Date.now() / (LEAD_RATE_WINDOW_SECONDS * 1_000));
  const fingerprint = await sha256Hex(
    `client-chat-lead-rate\u0000${botId}\u0000${origin}\u0000${clientAddress(request)}`,
  );
  const key = `lead-rate:v1:${bucket}:${fingerprint}`;
  let current = 0;
  try {
    const raw = await env.KB_CACHE.get(key);
    const parsed = Number(raw || "0");
    current = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
    if (current >= LEAD_RATE_LIMIT) return false;
    await env.KB_CACHE.put(key, String(current + 1), {
      expirationTtl: LEAD_RATE_WINDOW_SECONDS + 60,
    });
    return true;
  } catch {
    return null;
  }
}

function randomHex(bytes: number) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeLeadIndex(raw: string | null, botId: string) {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(
        parsed.filter(
          (item): item is string =>
            typeof item === "string" &&
            item.startsWith(`lead:${botId}:`) &&
            LEAD_KEY_PATTERN.test(item),
        ),
      ),
    ).slice(-LEAD_INDEX_MAXIMUM);
  } catch {
    return [];
  }
}

async function storeExplicitLead(
  env: LeadCaptureEnv,
  input: NonNullable<ReturnType<typeof sanitizeLeadRequest>>,
  origin: string,
) {
  const createdAt = new Date().toISOString();
  const key = `lead:${input.botId}:${Date.now()}:${randomHex(8)}`;
  const record = Object.freeze({
    contract: EXPLICIT_LEAD_CAPTURE_CONTRACT,
    leadId: key,
    botId: input.botId,
    createdAt,
    consent: Object.freeze({
      granted: true,
      version: LEAD_CONSENT_VERSION,
    }),
    source: Object.freeze({
      origin,
      path: input.lead.sourcePath || null,
    }),
    contact: Object.freeze({
      name: input.lead.name || null,
      email: input.lead.email,
      phone: input.lead.phone || null,
      company: input.lead.company || null,
    }),
    message: input.lead.message,
  });
  const indexKey = `lead:index:${input.botId}`;

  try {
    const index = safeLeadIndex(await env.BOT_CONFIG.get(indexKey), input.botId);
    await env.BOT_CONFIG.put(key, JSON.stringify(record));
    try {
      await env.BOT_CONFIG.put(
        indexKey,
        JSON.stringify([...index.filter((item) => item !== key), key].slice(-LEAD_INDEX_MAXIMUM)),
      );
    } catch {
      await env.BOT_CONFIG.delete(key).catch(() => undefined);
      return null;
    }
    return { leadId: key, createdAt } as const;
  } catch {
    return null;
  }
}

export function leadCapturePreflight(request: Request) {
  const origin = requestOrigin(request);
  if (!origin) return json(403, { ok: false, error: "origin_not_allowed" });
  return new Response(null, {
    status: 204,
    headers: secureHeaders({
      ...corsHeaders(origin),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
    }),
  });
}

export async function handleExplicitLeadCapture(
  request: Request,
  env: LeadCaptureEnv,
) {
  const origin = requestOrigin(request);
  if (!origin) return json(403, { ok: false, error: "origin_not_allowed" });

  const parsed = await readBoundedJsonObject(request, LEAD_REQUEST_MAX_BYTES);
  if (!parsed.ok) {
    return json(parsed.status, { ok: false, error: parsed.error }, origin);
  }
  const input = sanitizeLeadRequest(parsed.value);
  if (!input) {
    return json(400, { ok: false, error: "invalid_lead_request" }, origin);
  }

  const canonicalBotId = await resolveBotId(env, input.botId);
  if (!canonicalBotId) {
    return json(404, { ok: false, error: "bot_not_found" }, origin);
  }
  const config = parseStoredConfig(
    await env.BOT_CONFIG.get(`cfg:${canonicalBotId}`),
  );
  if (!config) return json(404, { ok: false, error: "bot_not_found" }, origin);
  const network = safeStoredNetworkConfig(config);
  if (!network) {
    return json(409, { ok: false, error: "unsafe_bot_configuration" }, origin);
  }
  if (browserOriginDecision(request, network.origins) !== origin) {
    return json(403, { ok: false, error: "origin_not_allowed" });
  }

  const rateDecision = await consumeLeadRateLimit(
    env,
    request,
    canonicalBotId,
    origin,
  );
  if (rateDecision === false) {
    return json(
      429,
      { ok: false, error: "lead_rate_limited" },
      origin,
      { "Retry-After": String(LEAD_RATE_WINDOW_SECONDS) },
    );
  }
  if (rateDecision === null) {
    return json(503, { ok: false, error: "lead_service_unavailable" }, origin);
  }

  const stored = await storeExplicitLead(
    env,
    { ...input, botId: canonicalBotId },
    origin,
  );
  if (!stored) {
    return json(503, { ok: false, error: "lead_service_unavailable" }, origin);
  }

  return json(
    201,
    {
      ok: true,
      leadId: stored.leadId,
      createdAt: stored.createdAt,
      consentVersion: LEAD_CONSENT_VERSION,
    },
    origin,
  );
}

export const explicitLeadCapturePosture = Object.freeze({
  contract: EXPLICIT_LEAD_CAPTURE_CONTRACT,
  visitorConsentRequired: true,
  exactBooleanConsentRequired: true,
  exactBrowserOriginRequired: true,
  nonBrowserLeadSubmissionAllowed: false,
  botKeyAccepted: false,
  boundedRequestBytes: LEAD_REQUEST_MAX_BYTES,
  requiredContactField: "email",
  requiredMessage: true,
  modelActionWritesLeadDirectly: false,
  rawIpStored: false,
  userAgentStored: false,
  externalNetworkCalls: false,
  bestEffortKvRateLimit: true,
  transactionalIndexGuarantee: false,
  historicalLeadIndexCompatibilityRequired: true,
  rawLeadEchoedInResponse: false,
});
