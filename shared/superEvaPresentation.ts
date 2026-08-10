export const SUPER_EVA_PRESENTATION_VERSION = "eva_super_presentation_v1" as const;

export type SuperEvaChatPresentation = Readonly<{
  contractVersion: typeof SUPER_EVA_PRESENTATION_VERSION;
  presentationId: string;
  text: string;
  spokenText: string;
  avatar: Readonly<{
    characterId: "eva-female";
    manifestRef: "evavo-avatar://eva-female/v1";
    state: "ready" | "listening" | "thinking" | "speaking" | "working" | "success" | "error" | "stopped";
    gesture: "idle" | "acknowledge" | "explain" | "emphasise" | "alert";
    emotion: "neutral" | "warm" | "focused" | "confident" | "concerned";
    animationProfile: "minimal" | "natural" | "expressive";
  }>;
  voice: Readonly<{
    profileId: "eva-original";
    language: "en-AU";
    delivery: "approved-audio" | "system-fallback" | "silent";
    outputMode: "normal" | "quiet" | "discreet" | "silent";
    rate: number;
    pitch: number;
    volume: number;
    audioRef: string | null;
  }>;
  storage: Readonly<{
    reference: string;
    retention: "ephemeral" | "session" | "kept" | "archival";
    status: "not-requested" | "planned" | "verified";
  }>;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSuperEvaChatPresentation(value: unknown): SuperEvaChatPresentation {
  if (!record(value) || !record(value.avatar) || !record(value.voice) || !record(value.storage)) {
    throw new Error("SUPER_EVA_CHAT_PRESENTATION_INVALID");
  }
  if (
    value.contractVersion !== SUPER_EVA_PRESENTATION_VERSION ||
    typeof value.presentationId !== "string" ||
    typeof value.text !== "string" ||
    typeof value.spokenText !== "string" ||
    value.avatar.characterId !== "eva-female" ||
    value.avatar.manifestRef !== "evavo-avatar://eva-female/v1" ||
    value.voice.profileId !== "eva-original" ||
    value.voice.language !== "en-AU" ||
    !["approved-audio", "system-fallback", "silent"].includes(String(value.voice.delivery)) ||
    typeof value.voice.rate !== "number" ||
    typeof value.voice.pitch !== "number" ||
    typeof value.voice.volume !== "number" ||
    value.voice.volume < 0 ||
    value.voice.volume > 1 ||
    (value.voice.audioRef !== null && typeof value.voice.audioRef !== "string") ||
    typeof value.storage.reference !== "string" ||
    !value.storage.reference.startsWith("evavo-storage://")
  ) {
    throw new Error("SUPER_EVA_CHAT_PRESENTATION_INVALID");
  }
  return Object.freeze(value as unknown as SuperEvaChatPresentation);
}
