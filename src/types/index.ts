export interface ConversationState {
  id: string;
  channelId: string;
  topic: string;
  participants: string[]; // AI model names + user IDs
  messages: Message[];
  contextWindow: {
    current: number;
    max: number;
    provider: string;
  };
  status: 'planning' | 'active' | 'paused' | 'completed' | 'stopped';
  planningState?: {
    questions: string[];
    plan?: string;
    expandedTopic?: string;
    parameters?: {
      maxMessages: number;
      maxTokens: number;
      timeoutMinutes: number;
      maxContextWindowPercent: number;
    };
    awaitingApproval: boolean;
    planningStartedAt: Date;
  };
  moderationState?: {
    topicDriftCount: number;
    lastTopicCheck: Date;
    originalObjectives: string[];
    currentFocus: string;
    participantBalance: Record<string, number>; // participantId -> message count
    qualityScore?: number;
  };
  createdAt: Date;
  lastActivity: Date;
  messageCount: number;
  tokenCount: number;
}

export interface Message {
  id: string;
  conversationId: string;
  authorId: string;
  authorType: 'user' | 'ai';
  content: string;
  replyTo: string[]; // Array of message IDs
  timestamp: Date;
  model?: string; // If AI message
  tokens?: number;
  discordMessageId?: string;
}

export interface AIResponse {
  content: string;
  model: string;
  tokens: number;
  replyTo: string[];
  contextUsed: number;
}

export interface AIAdapter {
  generateResponse(
    context: Message[],
    systemPrompt: string,
    replyTo?: string[]
  ): Promise<AIResponse>;
  checkContextWindow(messages: Message[]): number;
  getModelName(): string;
  getMaxContextWindow(): number;
  estimateTokens(text: string): number;
}

export interface Config {
  discord: {
    token: string;
    guildId: string;
    channelId: string;
  };
  openai: {
    apiKey: string;
    model: string;
  };
  anthropic: {
    apiKey: string;
    model: string;
  };
  grok: {
    apiKey: string;
    model: string;
    baseUrl: string;
  };
  cursor: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
  notion: {
    apiKey: string;
    reasoningPageId: string;
    tldrPageId: string;
  };
  limits: {
    maxMessagesPerConversation: number;
    maxTokensPerConversation: number;
    maxContextWindowPercent: number;
    contextRefreshThreshold: number;
    conversationTimeoutMinutes: number;
    maxAIResponsesPerTurn: number;
    batchReplyTimeWindowSeconds: number;
  };
  scribe: {
    updateInterval: number;
    model: string;
  };
  tldr: {
    updateInterval: number;
    model: string;
  };
  sessionPlanner: {
    model: string;
    timeoutMinutes: number;
    maxQuestions: number;
    autoStart: boolean;
  };
  moderator: {
    checkInterval: number;
    topicDriftThreshold: number;
    maxDriftWarnings: number;
    participantBalanceCheck: boolean;
    qualityAssessment: boolean;
  };
  logLevel: string;
}

