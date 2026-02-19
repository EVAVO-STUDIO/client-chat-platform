export type Role = "user" | "assistant";

export type ChatMessage = {
  role: Role;
  content: string;
};

export type LeadMode = "soft" | "balanced" | "aggressive";

export type BotConfig = {
  botId: string;

  // Brand / UI
  siteName: string;
  title?: string;
  brandHex?: string;
  greeting: string;

  // Business goals
  contactUrl: string;
  leadMode: LeadMode;

  // Safety / accuracy
  capabilities: string[];
  doNotClaim: string[];

  // Lead qualification
  qualifyingQuestions: string[];

  // CORS lockdown per bot
  allowedOrigins?: string[];

  // Optional: per-bot model override (keep cheap by default)
  model?: string;

  // Optional: token caps
  maxTokens?: number;

  /**
   * Optional: extra domain-specific knowledge for this bot.
   * Keep this concise (FAQ / pricing rules / policies / boundaries).
   */
  knowledge?: string;

  /**
   * Optional: URLs the bot may read from (static HTML recommended).
   * These are fetched server-side and cached.
   */
  knowledgeUrls?: string[];

  /**
   * Optional: enable lightweight retrieval from knowledgeUrls on each request.
   */
  ragEnabled?: boolean;

  /**
   * Optional: maximum number of URLs to fetch per chat request.
   */
  ragMaxUrlsPerRequest?: number;
};
