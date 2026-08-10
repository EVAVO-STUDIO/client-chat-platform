export const SUPER_EVA_PRESENTATION_VERSION =
  "eva_super_presentation_v1" as const;

export type SuperEvaPresentationState =
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "working"
  | "success"
  | "error"
  | "stopped";
export type SuperEvaOutputMode =
  | "normal"
  | "quiet"
  | "discreet"
  | "silent";

export type SuperEvaChatPresentation = Readonly<{
  contractVersion: typeof SUPER_EVA_PRESENTATION_VERSION;
  requestId: string;
  presentationId: string;
  conversationId: string;
  messageId: string;
  createdAt: string;
  expiresAt: string;
  text: string;
  spokenText: string;
  state: SuperEvaPresentationState;
  avatar: Readonly<{
    characterId: "eva-female";
    manifestRef: "evavo-avatar://eva-female/v1";
    state: SuperEvaPresentationState;
    gesture: "idle" | "acknowledge" | "explain" | "emphasise" | "alert";
    emotion: "neutral" | "warm" | "focused" | "confident" | "concerned";
    animationProfile: "minimal" | "natural" | "expressive";
    reducedMotionFallback: "static-breath";
  }>;
  voice: Readonly<{
    profileId: "eva-original";
    language: "en-AU";
    delivery: "approved-audio" | "system-fallback" | "silent";
    admissionStatus: "approved" | "fallback" | "unavailable";
    rightsStatus:
      | "verified"
      | "not-required-for-system-fallback"
      | "unverified";
    outputMode: SuperEvaOutputMode;
    rate: number;
    pitch: number;
    volume: number;
    contentSha256: string;
    audioRef: string | null;
    manifestRef: string | null;
  }>;
  wearable: Readonly<{
    enabled: boolean;
    spokenText: string;
    voiceId: "eva-original";
    outputMode: SuperEvaOutputMode;
    interruptible: true;
    sensitivity: "public" | "personal" | "sensitive" | "restricted";
    audioRoute: "open-ear" | "earpiece" | "speaker" | "unknown";
    peopleNearby: boolean;
  }>;
  storage: Readonly<{
    reference: string;
    retention: "ephemeral" | "session" | "kept" | "archival";
    status: "not-requested" | "planned" | "verified";
    expiresAt: string | null;
    contentSha256: string;
    storeText: false;
    storeAudioByReference: true;
    backupState: "none" | "queued" | "verified";
  }>;
  provenance: Readonly<{
    producer:
      | "EVAVO-STUDIO/client-chat-platform"
      | "EVAVO-STUDIO/chatbot-backend"
      | "EVAVO-STUDIO/super-admin-ai-agent";
    avatarRuntime: "EVAVO-STUDIO/evavo-avatar-runtime";
    audioStudio: "EVAVO-STUDIO/evavo-audio-studio";
    storage: "EVAVO-STUDIO/evavo-storage";
    glassesRuntime: "EVAVO-STUDIO/evavo-glasses";
  }>;
}>;

const CONTROL_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;
const PRESENTATION_ID_PATTERN =
  /^eva_presentation_[A-Za-z0-9_-]{8,96}$/u;
const MESSAGE_ID_PATTERN = /^eva_message_[A-Za-z0-9_-]{8,96}$/u;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return (
    actual.length === required.length &&
    actual.every((key, index) => key === required[index])
  );
}

function canonicalText(
  value: unknown,
  maximum: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value.length <= maximum &&
    value.normalize("NFC") === value &&
    !CONTROL_PATTERN.test(value)
  );
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 40) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

export function parseSuperEvaChatPresentation(
  value: unknown,
): SuperEvaChatPresentation {
  if (
    !record(value) ||
    !exactKeys(value, [
      "avatar",
      "contractVersion",
      "conversationId",
      "createdAt",
      "expiresAt",
      "messageId",
      "presentationId",
      "provenance",
      "requestId",
      "spokenText",
      "state",
      "storage",
      "text",
      "voice",
      "wearable",
    ]) ||
    value.contractVersion !== SUPER_EVA_PRESENTATION_VERSION ||
    typeof value.requestId !== "string" ||
    !IDENTIFIER_PATTERN.test(value.requestId) ||
    typeof value.presentationId !== "string" ||
    !PRESENTATION_ID_PATTERN.test(value.presentationId) ||
    typeof value.conversationId !== "string" ||
    !IDENTIFIER_PATTERN.test(value.conversationId) ||
    typeof value.messageId !== "string" ||
    !MESSAGE_ID_PATTERN.test(value.messageId) ||
    !canonicalTimestamp(value.createdAt) ||
    !canonicalTimestamp(value.expiresAt) ||
    !canonicalText(value.text, 16_000) ||
    !canonicalText(value.spokenText, 8_000, true) ||
    ![
      "ready",
      "listening",
      "thinking",
      "speaking",
      "working",
      "success",
      "error",
      "stopped",
    ].includes(String(value.state)) ||
    !record(value.avatar) ||
    !record(value.voice) ||
    !record(value.wearable) ||
    !record(value.storage) ||
    !record(value.provenance)
  ) {
    throw new Error("SUPER_EVA_CHAT_PRESENTATION_INVALID");
  }

  if (
    !exactKeys(value.avatar, [
      "animationProfile",
      "characterId",
      "emotion",
      "gesture",
      "manifestRef",
      "reducedMotionFallback",
      "state",
    ]) ||
    value.avatar.characterId !== "eva-female" ||
    value.avatar.manifestRef !== "evavo-avatar://eva-female/v1" ||
    value.avatar.state !== value.state ||
    !["idle", "acknowledge", "explain", "emphasise", "alert"].includes(
      String(value.avatar.gesture),
    ) ||
    !["neutral", "warm", "focused", "confident", "concerned"].includes(
      String(value.avatar.emotion),
    ) ||
    !["minimal", "natural", "expressive"].includes(
      String(value.avatar.animationProfile),
    ) ||
    value.avatar.reducedMotionFallback !== "static-breath"
  ) {
    throw new Error("SUPER_EVA_CHAT_AVATAR_INVALID");
  }

  if (
    !exactKeys(value.voice, [
      "admissionStatus",
      "audioRef",
      "contentSha256",
      "delivery",
      "language",
      "manifestRef",
      "outputMode",
      "pitch",
      "profileId",
      "rate",
      "rightsStatus",
      "volume",
    ]) ||
    value.voice.profileId !== "eva-original" ||
    value.voice.language !== "en-AU" ||
    !["approved-audio", "system-fallback", "silent"].includes(
      String(value.voice.delivery),
    ) ||
    !["approved", "fallback", "unavailable"].includes(
      String(value.voice.admissionStatus),
    ) ||
    ![
      "verified",
      "not-required-for-system-fallback",
      "unverified",
    ].includes(String(value.voice.rightsStatus)) ||
    !["normal", "quiet", "discreet", "silent"].includes(
      String(value.voice.outputMode),
    ) ||
    !boundedNumber(value.voice.rate, 0.5, 2) ||
    !boundedNumber(value.voice.pitch, 0.5, 2) ||
    !boundedNumber(value.voice.volume, 0, 1) ||
    typeof value.voice.contentSha256 !== "string" ||
    !SHA256_PATTERN.test(value.voice.contentSha256) ||
    (value.voice.audioRef !== null &&
      (typeof value.voice.audioRef !== "string" ||
        !value.voice.audioRef.startsWith("evavo-storage://"))) ||
    (value.voice.manifestRef !== null &&
      (typeof value.voice.manifestRef !== "string" ||
        !value.voice.manifestRef.startsWith("evavo-audio://")))
  ) {
    throw new Error("SUPER_EVA_CHAT_VOICE_INVALID");
  }

  if (
    !exactKeys(value.wearable, [
      "audioRoute",
      "enabled",
      "interruptible",
      "outputMode",
      "peopleNearby",
      "sensitivity",
      "spokenText",
      "voiceId",
    ]) ||
    typeof value.wearable.enabled !== "boolean" ||
    value.wearable.spokenText !== value.spokenText ||
    value.wearable.voiceId !== "eva-original" ||
    value.wearable.outputMode !== value.voice.outputMode ||
    value.wearable.interruptible !== true ||
    !["public", "personal", "sensitive", "restricted"].includes(
      String(value.wearable.sensitivity),
    ) ||
    !["open-ear", "earpiece", "speaker", "unknown"].includes(
      String(value.wearable.audioRoute),
    ) ||
    typeof value.wearable.peopleNearby !== "boolean"
  ) {
    throw new Error("SUPER_EVA_CHAT_WEARABLE_INVALID");
  }

  if (
    !exactKeys(value.storage, [
      "backupState",
      "contentSha256",
      "expiresAt",
      "reference",
      "retention",
      "status",
      "storeAudioByReference",
      "storeText",
    ]) ||
    typeof value.storage.reference !== "string" ||
    !value.storage.reference.startsWith("evavo-storage://") ||
    !["ephemeral", "session", "kept", "archival"].includes(
      String(value.storage.retention),
    ) ||
    !["not-requested", "planned", "verified"].includes(
      String(value.storage.status),
    ) ||
    (value.storage.expiresAt !== null &&
      !canonicalTimestamp(value.storage.expiresAt)) ||
    value.storage.contentSha256 !== value.voice.contentSha256 ||
    value.storage.storeText !== false ||
    value.storage.storeAudioByReference !== true ||
    !["none", "queued", "verified"].includes(
      String(value.storage.backupState),
    )
  ) {
    throw new Error("SUPER_EVA_CHAT_STORAGE_INVALID");
  }

  if (
    !exactKeys(value.provenance, [
      "audioStudio",
      "avatarRuntime",
      "glassesRuntime",
      "producer",
      "storage",
    ]) ||
    ![
      "EVAVO-STUDIO/client-chat-platform",
      "EVAVO-STUDIO/chatbot-backend",
      "EVAVO-STUDIO/super-admin-ai-agent",
    ].includes(String(value.provenance.producer)) ||
    value.provenance.avatarRuntime !==
      "EVAVO-STUDIO/evavo-avatar-runtime" ||
    value.provenance.audioStudio !== "EVAVO-STUDIO/evavo-audio-studio" ||
    value.provenance.storage !== "EVAVO-STUDIO/evavo-storage" ||
    value.provenance.glassesRuntime !== "EVAVO-STUDIO/evavo-glasses"
  ) {
    throw new Error("SUPER_EVA_CHAT_PROVENANCE_INVALID");
  }

  if (
    (value.voice.delivery === "approved-audio" &&
      (value.voice.admissionStatus !== "approved" ||
        value.voice.rightsStatus !== "verified" ||
        value.voice.audioRef === null ||
        value.voice.manifestRef === null ||
        value.storage.status !== "verified")) ||
    (value.voice.delivery === "system-fallback" &&
      (value.voice.admissionStatus !== "fallback" ||
        value.voice.rightsStatus !==
          "not-required-for-system-fallback" ||
        value.voice.audioRef !== null ||
        value.voice.manifestRef !== null)) ||
    (value.voice.delivery === "silent" &&
      (value.voice.outputMode !== "silent" ||
        value.voice.volume !== 0 ||
        value.spokenText !== "" ||
        value.wearable.enabled))
  ) {
    throw new Error("SUPER_EVA_CHAT_BINDING_INVALID");
  }

  return Object.freeze(value as unknown as SuperEvaChatPresentation);
}

function bytesToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function superEvaPresentationContentMatches(
  presentation: SuperEvaChatPresentation,
): Promise<boolean> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return false;
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(presentation.spokenText),
  );
  return bytesToHex(digest) === presentation.voice.contentSha256;
}
