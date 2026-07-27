export const PRIVACY_FINGERPRINT_CONTRACT =
  "client_chat_privacy_fingerprint_v1" as const;

export const PRIVACY_HASH_SECRET_MIN_BYTES = 32;
export const PRIVACY_HASH_SECRET_MAX_BYTES = 256;

export type PrivacySecretEnvironment = Readonly<{
  PRIVACY_HASH_SECRET?: string;
  ADMIN_TOKEN?: string;
}>;

export type PrivacySecretSource = "privacy_hash_secret" | "admin_token_fallback";

export type PrivacyFingerprintResult =
  | Readonly<{
      ok: true;
      digest: string;
      source: PrivacySecretSource;
      contract: typeof PRIVACY_FINGERPRINT_CONTRACT;
    }>
  | Readonly<{
      ok: false;
      error: "privacy_hash_not_configured";
      contract: typeof PRIVACY_FINGERPRINT_CONTRACT;
    }>;

function encoded(value: string) {
  return new TextEncoder().encode(value);
}

export function validPrivacyHashSecret(value: unknown): value is string {
  if (typeof value !== "string" || !value || /\s/.test(value)) return false;
  const bytes = encoded(value).byteLength;
  return (
    bytes >= PRIVACY_HASH_SECRET_MIN_BYTES &&
    bytes <= PRIVACY_HASH_SECRET_MAX_BYTES
  );
}

export function resolvePrivacyHashSecret(
  env: PrivacySecretEnvironment,
): Readonly<{ secret: string; source: PrivacySecretSource }> | null {
  if (validPrivacyHashSecret(env.PRIVACY_HASH_SECRET)) {
    return {
      secret: env.PRIVACY_HASH_SECRET,
      source: "privacy_hash_secret",
    };
  }
  if (validPrivacyHashSecret(env.ADMIN_TOKEN)) {
    return {
      secret: env.ADMIN_TOKEN,
      source: "admin_token_fallback",
    };
  }
  return null;
}

async function hmacSha256Hex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoded(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoded(payload));
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function privacyFingerprint(
  env: PrivacySecretEnvironment,
  domain: string,
  value: string,
): Promise<PrivacyFingerprintResult> {
  const resolved = resolvePrivacyHashSecret(env);
  if (!resolved) {
    return {
      ok: false,
      error: "privacy_hash_not_configured",
      contract: PRIVACY_FINGERPRINT_CONTRACT,
    };
  }
  const digest = await hmacSha256Hex(
    resolved.secret,
    `${PRIVACY_FINGERPRINT_CONTRACT}\u0000${domain}\u0000${value}`,
  );
  return {
    ok: true,
    digest,
    source: resolved.source,
    contract: PRIVACY_FINGERPRINT_CONTRACT,
  };
}

export const privacyFingerprintPosture = Object.freeze({
  contract: PRIVACY_FINGERPRINT_CONTRACT,
  algorithm: "HMAC-SHA-256",
  dedicatedSecretPreferred: true,
  boundedAdminTokenFallbackAllowed: true,
  unkeyedClientAddressDigestAllowed: false,
  rawClientAddressReturned: false,
  rawClientAddressStored: false,
  domainSeparationRequired: true,
  missingSecretFailsClosed: true,
});
