export type ModelInferenceKind = "chat" | "embedding";

export const MODEL_EMBEDDING_MAX_TEXT_CHARS = 2_000;
export const MODEL_EMBEDDING_MAX_BATCH_ITEMS = 24;

const CHAT_ROLES = new Set(["system", "user", "assistant"]);

function firstModelArgument(args: readonly unknown[]) {
  const value = args[0];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function chatMessageAllowed(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message.role === "string" &&
    CHAT_ROLES.has(message.role) &&
    typeof message.content === "string" &&
    message.content.trim().length > 0
  );
}

function chatMessagesAllowed(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(chatMessageAllowed)
  );
}

function embeddingTextAllowed(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MODEL_EMBEDDING_MAX_TEXT_CHARS
  );
}

function embeddingTextArrayAllowed(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MODEL_EMBEDDING_MAX_BATCH_ITEMS &&
    value.every(embeddingTextAllowed)
  );
}

export function classifyModelInferenceKind(
  args: readonly unknown[],
): ModelInferenceKind {
  const request = firstModelArgument(args);
  if (!request) throw new Error("model_request_shape_not_approved");

  const hasMessages = Object.prototype.hasOwnProperty.call(request, "messages");
  const hasText = Object.prototype.hasOwnProperty.call(request, "text");
  const hasTexts = Object.prototype.hasOwnProperty.call(request, "texts");
  const chatRequested = chatMessagesAllowed(request.messages);

  if (hasMessages && !chatRequested) {
    throw new Error("model_request_shape_not_approved");
  }
  if (chatRequested && (hasText || hasTexts)) {
    throw new Error("model_request_shape_ambiguous");
  }
  if (chatRequested) return "chat";
  if (hasText && hasTexts) {
    throw new Error("model_request_shape_ambiguous");
  }
  if (hasText) {
    if (
      embeddingTextAllowed(request.text) ||
      embeddingTextArrayAllowed(request.text)
    ) {
      return "embedding";
    }
    throw new Error("model_request_shape_not_approved");
  }
  if (hasTexts) {
    if (embeddingTextArrayAllowed(request.texts)) return "embedding";
    throw new Error("model_request_shape_not_approved");
  }
  throw new Error("model_request_shape_not_approved");
}

export const modelInferenceBoundaryPosture = Object.freeze({
  contract: "client_chat_model_inference_boundary_v1" as const,
  chatMessagesMustBeNonEmpty: true,
  chatMessagesMustUseReviewedRolesAndNonEmptyText: true,
  embeddingTextMaximumCharacters: MODEL_EMBEDDING_MAX_TEXT_CHARS,
  embeddingBatchMaximumItems: MODEL_EMBEDDING_MAX_BATCH_ITEMS,
  embeddingBatchItemsMustBeBoundedStrings: true,
  whitespaceOnlyEmbeddingTextRejected: true,
  mixedChatAndEmbeddingShapeRejected: true,
  dualEmbeddingInputFormsRejected: true,
  unknownInferenceShapeRejected: true,
  providerAuthority: false,
  networkAuthority: false,
  storageAuthority: false,
});
