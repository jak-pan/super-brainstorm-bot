export interface ConversationState {
  id: string;
  channelId: string;
  topic: string;
  participants: string[]; // AI model names + user IDs
  selectedModels: string[]; // Selected AI models for this conversation (OpenRouter model IDs)
  taskType?: 'general' | 'coding' | 'architecture'; // Detected or user-selected task type
  scribeModel?: string; // Override scribe model for this conversation
  tldrModel?: string; // Override TLDR model for this conversation
  messages: Message[];
  // Context window is now managed automatically by the AI models
  status: 'planning' | 'active' | 'paused' | 'completed' | 'stopped';
  planningState?: {
    questions: string[];
    plan?: string;
    expandedTopic?: string;
    parameters?: {
      maxMessages: number;
      costLimit: number;
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
  costTracking?: {
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    costsByModel: Record<string, {
      cost: number;
      inputTokens: number;
      outputTokens: number;
      requestCount: number;
    }>;
  };
  imageCostTracking?: {
    totalCost: number;
    totalImages: number;
    costsByModel: Record<string, {
      cost: number;
      imageCount: number;
      requestCount: number;
    }>;
  };
  costLimit?: number; // Cost limit in USD for conversation (default: $22)
  imageCostLimit?: number; // Cost limit in USD for image generation (default: $2)
  imageGenerationBlocked?: boolean; // Whether image generation is blocked due to cost limit
  disabledAgents?: string[]; // List of disabled agent model IDs (manager, scribe, tldr, image cannot be disabled)
  activeAgents?: string[]; // List of agent model IDs that were actually launched (for tracking which can be stopped)
  imageModels?: string[]; // Image generation models for this conversation
  threadId?: string; // Discord thread ID if conversation is in a thread
  isThread?: boolean; // Whether this conversation is in a thread
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
  inputTokens: number;
  outputTokens: number;
  replyTo: string[];
  contextUsed: number;
  cost?: number;
  costBreakdown?: {
    inputCost: number;
    outputCost: number;
    totalCost: number;
  };
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

// Model configuration types removed - we now use OpenRouter API directly
// Model selection is done via default-settings.json with OpenRouter model IDs
// Cost is provided directly by OpenRouter API in the response (total_cost)

export interface Config {
  discord: {
    token: string;
    guildId: string;
    channelId: string;
  };
  openrouter: {
    apiKey: string;
  };
  notion: {
    apiKey: string;
    databaseId: string; // Single database/page ID
  };
  limits: {
    maxMessagesPerConversation: number;
    maxContextWindowPercent: number;
    contextRefreshThreshold: number;
    conversationTimeoutMinutes: number;
    maxAIResponsesPerTurn: number;
    batchReplyTimeWindowSeconds: number;
  };
  costLimits: {
    conversation: number;
    image: number;
  };
  scribe: {
    updateInterval: number;
  };
  tldr: {
    updateInterval: number;
  };
  sessionPlanner: {
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
  defaultSettings: import("../config/settings-loader.js").DefaultSettings;
}

