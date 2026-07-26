export const CHAT_SECURITY_CONTRACT = "client_chat_security_v2" as const;
export const ADMIN_REQUEST_MAX_BYTES = 64 * 1024;
export const CHAT_REQUEST_MAX_BYTES = 128 * 1024;
export const PUBLIC_TEXT_MAX_BYTES = 512 * 1024;
export const PUBLIC_FETCH_TIMEOUT_MS = 10_000;

const ADMIN_TOKEN_MIN_BYTES = 32;
const ADMIN_TOKEN_MAX_BYTES = 256;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_NODES = 4_000;
const MAX_JSON_ARRAY_LENGTH = 200;
const MAX_JSON_STRING_LENGTH = 200_000;
const MAX_JSON_KEY_LENGTH = 256;
const MAX_PUBLIC_URL_LENGTH = 2_048;
const BLOCKED_JSON_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".test",
  ".invalid",
  ".example",
  ".onion",
  ".arpa",
];
const BLOCKED_EXACT_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);
const LOCAL_DEVELOPMENT_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "client_secret",
  "credential",
  "key",
  "password",
  "secret",
  "session",
  "signature",
  "sig",
  "token",
]);

export type BoundedJsonResult =
  | Readonly<{ ok: true; value: Record<string, unknown>; bytes: number }>
  | Readonly<{
      ok: false;
      status: 400 | 411 | 413 | 415;
      error:
        | "content_type_required"
        | "invalid_content_length"
        | "request_body_required"
        | "request_body_too_large"
        | "invalid_utf8_body"
        | "invalid_json_body"
        | "json_object_required"
        | "json_structure_too_complex";
    }>;

function mediaType(request: Request) {
  return String(request.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function validJsonMediaType(value: string) {
  return value === "application/json" || /^application\/[a-z0-9.+-]+\+json$/i.test(value);
}

function structuralJsonAllowed(value: unknown) {
  let nodes = 0;
  const visit = (candidate: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return false;
    if (typeof candidate === "string") return candidate.length <= MAX_JSON_STRING_LENGTH;
    if (
      candidate === null ||
      typeof candidate === "boolean" ||
      typeof candidate === "number"
    ) {
      return true;
    }
    if (Array.isArray(candidate)) {
      if (candidate.length > MAX_JSON_ARRAY_LENGTH) return false;
      return candidate.every((item) => visit(item, depth + 1));
    }
    if (!candidate || typeof candidate !== "object") return false;
    for (const [key, nested] of Object.entries(candidate)) {
      if (key.length > MAX_JSON_KEY_LENGTH || BLOCKED_JSON_KEYS.has(key)) return false;
      if (!visit(nested, depth + 1)) return false;
    }
    return true;
  };
  return visit(value, 0);
}

export async function readBoundedJsonObject(
  request: Request,
  maximumBytes: number,
): Promise<BoundedJsonResult> {
  if (!validJsonMediaType(mediaType(request))) {
    return { ok: false, status: 415, error: "content_type_required" };
  }

  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) {
      return { ok: false, status: 411, error: "invalid_content_length" };
    }
    const parsedLength = Number(declared);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      return { ok: false, status: 411, error: "invalid_content_length" };
    }
    if (parsedLength > maximumBytes) {
      return { ok: false, status: 413, error: "request_body_too_large" };
    }
  }

  if (!request.body) {
    return { ok: false, status: 400, error: "request_body_required" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      bytes += next.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel("request_body_too_large").catch(() => undefined);
        return { ok: false, status: 413, error: "request_body_too_large" };
      }
      chunks.push(next.value);
    }
  } catch {
    return { ok: false, status: 400, error: "invalid_utf8_body" };
  } finally {
    reader.releaseLock();
  }

  if (bytes === 0) return { ok: false, status: 400, error: "request_body_required" };
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(combined);
  } catch {
    return { ok: false, status: 400, error: "invalid_utf8_body" };
  }

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return { ok: false, status: 400, error: "invalid_json_body" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, status: 400, error: "json_object_required" };
  }
  if (!structuralJsonAllowed(value)) {
    return { ok: false, status: 400, error: "json_structure_too_complex" };
  }
  return { ok: true, value: value as Record<string, unknown>, bytes };
}

function credentialBytes(value: string) {
  return new TextEncoder().encode(value);
}

function boundedSecretShape(value: unknown, minimumBytes: number, maximumBytes: number) {
  if (typeof value !== "string" || !value || /\s/.test(value)) return false;
  const bytes = credentialBytes(value).byteLength;
  return bytes >= minimumBytes && bytes <= maximumBytes;
}

export function configuredAdminTokenAllowed(value: unknown): value is string {
  return boundedSecretShape(value, ADMIN_TOKEN_MIN_BYTES, ADMIN_TOKEN_MAX_BYTES);
}

function exactBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  return configuredAdminTokenAllowed(token) ? token : null;
}

async function sha256Bytes(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", credentialBytes(value));
  return new Uint8Array(digest);
}

function fixedDigestEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function boundedSecretEqual(
  provided: unknown,
  expected: unknown,
  minimumBytes: number,
  maximumBytes: number,
) {
  if (
    !boundedSecretShape(provided, minimumBytes, maximumBytes) ||
    !boundedSecretShape(expected, minimumBytes, maximumBytes)
  ) {
    return false;
  }
  const [providedDigest, expectedDigest] = await Promise.all([
    sha256Bytes(provided as string),
    sha256Bytes(expected as string),
  ]);
  return fixedDigestEqual(providedDigest, expectedDigest);
}

export async function isAdminRequestAuthorized(request: Request, configuredToken: unknown) {
  const provided = exactBearerToken(request);
  if (!provided) return false;
  return boundedSecretEqual(
    provided,
    configuredToken,
    ADMIN_TOKEN_MIN_BYTES,
    ADMIN_TOKEN_MAX_BYTES,
  );
}

export async function sha256Hex(value: string) {
  const digest = await sha256Bytes(value);
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeHostname(url: URL) {
  return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function parseIpv4(hostname: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const parts = hostname.split(".").map(Number);
  return parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function blockedIpv4(parts: number[]) {
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return a >= 224;
}

function blockedIpv6(hostname: string) {
  if (!hostname.includes(":")) return false;
  const value = hostname.toLowerCase();
  return (
    value === "::" ||
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    /^fe[89ab]/.test(value) ||
    value.startsWith("ff") ||
    value.startsWith("2001:db8:") ||
    value.startsWith("::ffff:")
  );
}

function publicHostname(hostname: string) {
  if (!hostname || BLOCKED_EXACT_HOSTS.has(hostname)) return false;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false;
  const ipv4 = parseIpv4(hostname);
  if (ipv4) return !blockedIpv4(ipv4);
  if (blockedIpv6(hostname)) return false;
  return hostname.includes(".");
}

function localDevelopmentHostname(hostname: string) {
  return LOCAL_DEVELOPMENT_HOSTS.has(hostname);
}

function hasSensitiveQuery(url: URL) {
  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase().replace(/[-.]/g, "_");
    if (SENSITIVE_QUERY_KEYS.has(normalized)) return true;
  }
  return false;
}

export function normalizePublicHttpsUrl(raw: unknown, base?: string) {
  const source = String(raw || "").trim();
  if (!source || source.length > MAX_PUBLIC_URL_LENGTH) return null;
  try {
    const url = base ? new URL(source, base) : new URL(source);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (url.port && url.port !== "443") return null;
    if (!publicHostname(normalizeHostname(url)) || hasSensitiveQuery(url)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeAllowedOrigin(raw: unknown) {
  const source = String(raw || "").trim();
  if (!source || source.length > 512 || source.includes("*")) return null;
  try {
    const url = new URL(source);
    const hostname = normalizeHostname(url);
    const securePublicOrigin = url.protocol === "https:" && publicHostname(hostname);
    const localDevelopmentOrigin =
      url.protocol === "http:" && localDevelopmentHostname(hostname);
    if (
      (!securePublicOrigin && !localDevelopmentOrigin) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function responseLooksBinary(bytes: Uint8Array) {
  const sample = bytes.subarray(0, Math.min(bytes.byteLength, 8_192));
  if (sample.includes(0)) return true;
  let controls = 0;
  for (const byte of sample) {
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) controls += 1;
  }
  return sample.byteLength > 0 && controls / sample.byteLength > 0.05;
}

async function readResponseBody(
  response: Response,
  maximumBytes: number,
  deadline: number,
  controller: AbortController,
) {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared) || Number(declared) > maximumBytes) {
      controller.abort();
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (Date.now() >= deadline) {
        controller.abort();
        await reader.cancel("response_timeout").catch(() => undefined);
        return null;
      }
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        controller.abort();
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
  return combined;
}

export async function fetchBoundedPublicText(
  rawUrl: unknown,
  options: Readonly<{
    maximumBytes?: number;
    timeoutMs?: number;
    maximumRedirects?: number;
  }> = {},
) {
  const requestedUrl = normalizePublicHttpsUrl(rawUrl);
  if (!requestedUrl) return null;
  const maximumBytes = Math.max(
    16_384,
    Math.min(PUBLIC_TEXT_MAX_BYTES, options.maximumBytes ?? PUBLIC_TEXT_MAX_BYTES),
  );
  const timeoutMs = Math.max(
    1_000,
    Math.min(20_000, options.timeoutMs ?? PUBLIC_FETCH_TIMEOUT_MS),
  );
  const maximumRedirects = Math.max(
    0,
    Math.min(4, options.maximumRedirects ?? 3),
  );
  const deadline = Date.now() + timeoutMs;
  const visited = new Set<string>();
  let currentUrl = requestedUrl;
  let redirects = 0;

  while (true) {
    if (visited.has(currentUrl) || Date.now() >= deadline) return null;
    visited.add(currentUrl);
    const controller = new AbortController();
    const remaining = Math.max(1, deadline - Date.now());
    const timeout = setTimeout(() => controller.abort(), remaining);
    let response: Response | undefined;
    try {
      response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,text/plain,application/xhtml+xml;q=0.9",
          "User-Agent": "EVAVO-Client-Chat/2.0 (+https://evavo.com.au)",
        },
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location || redirects >= maximumRedirects) return null;
        const nextUrl = normalizePublicHttpsUrl(location, currentUrl);
        if (!nextUrl) return null;
        currentUrl = nextUrl;
        redirects += 1;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }

      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (
        contentType &&
        !/(?:text\/html|text\/plain|application\/xhtml\+xml)/.test(contentType)
      ) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      const bytes = await readResponseBody(
        response,
        maximumBytes,
        deadline,
        controller,
      );
      if (!bytes || Date.now() > deadline || responseLooksBinary(bytes)) return null;
      try {
        return {
          text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          finalUrl: currentUrl,
          contentType,
          bytes: bytes.byteLength,
          redirects,
        } as const;
      } catch {
        return null;
      }
    } catch {
      await response?.body?.cancel().catch(() => undefined);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const chatSecurityPosture = Object.freeze({
  contract: CHAT_SECURITY_CONTRACT,
  boundedJsonBodies: true,
  prototypePollutionKeysRejected: true,
  exactBearerAuthentication: true,
  legacyAdminHeaderAllowed: false,
  minimumAdminCredentialBytes: ADMIN_TOKEN_MIN_BYTES,
  maximumAdminCredentialBytes: ADMIN_TOKEN_MAX_BYTES,
  publicHttpsResearchOnly: true,
  privateNetworkResearchAllowed: false,
  dnsRebindingMitigatedByRuntimePublicFetchFlag: true,
  automaticRedirectFollowingAllowed: false,
  redirectTargetsRevalidated: true,
  sensitiveQueryCredentialsAllowed: false,
  wildcardBrowserOriginsAllowed: false,
  localHttpOriginsDevelopmentOnly: true,
  responseBodiesBounded: true,
  binaryResponsesAllowed: false,
  fullOperationTimeoutRequired: true,
  dormantWebhookHelperPresent: false,
});