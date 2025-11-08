import dotenv from "dotenv";
import type { Config } from "../types/index.js";
import {
  loadModelsConfig,
  getSmartestModel,
  getDefaultModel,
} from "../utils/cost-calculator.js";

dotenv.config();

export function loadConfig(): Config {
  const requiredEnvVars = [
    "DISCORD_BOT_TOKEN",
    "DISCORD_GUILD_ID",
    "DISCORD_CHANNEL_ID",
    "NOTION_API_KEY",
    "NOTION_REASONING_PAGE_ID",
    "NOTION_TLDR_PAGE_ID",
  ];

  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  // Check that at least one AI provider is available
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasGrok = !!process.env.GROK_API_KEY;

  if (!hasOpenAI && !hasAnthropic && !hasGrok) {
    throw new Error(
      "At least one AI provider API key is required (OPENAI_API_KEY, ANTHROPIC_API_KEY, or GROK_API_KEY)"
    );
  }

  // Load models configuration
  const modelsConfig = loadModelsConfig();

  // Determine default models based on available providers
  const availableProviders: ("openai" | "anthropic" | "grok")[] = [];
  if (hasOpenAI) availableProviders.push("openai");
  if (hasAnthropic) availableProviders.push("anthropic");
  if (hasGrok) availableProviders.push("grok");

  // Get smartest models for fallback
  const openaiModel = hasOpenAI
    ? process.env.OPENAI_MODEL ||
      getSmartestModel("openai") ||
      getDefaultModel("openai") ||
      "gpt-4o"
    : getSmartestModel("openai") || getDefaultModel("openai") || "gpt-4o";

  const anthropicModel = hasAnthropic
    ? process.env.ANTHROPIC_MODEL ||
      getSmartestModel("anthropic") ||
      getDefaultModel("anthropic") ||
      "claude-3-5-sonnet-20241022"
    : getSmartestModel("anthropic") ||
      getDefaultModel("anthropic") ||
      "claude-3-5-sonnet-20241022";

  const grokModel = hasGrok
    ? process.env.GROK_MODEL ||
      getSmartestModel("grok") ||
      getDefaultModel("grok") ||
      "grok-beta"
    : getSmartestModel("grok") || getDefaultModel("grok") || "grok-beta";

  // Determine default models for services (prefer OpenAI, fallback to available)
  const defaultServiceModel = hasOpenAI
    ? "chatgpt"
    : hasAnthropic
    ? "claude"
    : "grok";

  return {
    discord: {
      token: process.env.DISCORD_BOT_TOKEN!,
      guildId: process.env.DISCORD_GUILD_ID!,
      channelId: process.env.DISCORD_CHANNEL_ID!,
    },
    openai: hasOpenAI
      ? {
          apiKey: process.env.OPENAI_API_KEY!,
          model: openaiModel,
        }
      : undefined,
    anthropic: hasAnthropic
      ? {
          apiKey: process.env.ANTHROPIC_API_KEY!,
          model: anthropicModel,
        }
      : undefined,
    grok: hasGrok
      ? {
          apiKey: process.env.GROK_API_KEY!,
          model: grokModel,
          baseUrl: process.env.GROK_BASE_URL || "https://api.x.ai/v1",
        }
      : undefined,
    notion: {
      apiKey: process.env.NOTION_API_KEY!,
      reasoningPageId: process.env.NOTION_REASONING_PAGE_ID!,
      tldrPageId: process.env.NOTION_TLDR_PAGE_ID!,
    },
    limits: {
      maxMessagesPerConversation: parseInt(
        process.env.MAX_MESSAGES_PER_CONVERSATION || "1000",
        10
      ),
      maxTokensPerConversation: parseInt(
        process.env.MAX_TOKENS_PER_CONVERSATION || "5000000",
        10
      ),
      maxContextWindowPercent: parseInt(
        process.env.MAX_CONTEXT_WINDOW_PERCENT || "80",
        10
      ),
      contextRefreshThreshold: parseInt(
        process.env.CONTEXT_REFRESH_THRESHOLD || "50",
        10
      ),
      conversationTimeoutMinutes: parseInt(
        process.env.CONVERSATION_TIMEOUT_MINUTES || "60",
        10
      ),
      maxAIResponsesPerTurn: parseInt(
        process.env.MAX_AI_RESPONSES_PER_TURN || "3",
        10
      ),
      batchReplyTimeWindowSeconds: parseInt(
        process.env.BATCH_REPLY_TIME_WINDOW_SECONDS || "60",
        10
      ),
    },
    scribe: {
      updateInterval: parseInt(process.env.SCRIBE_UPDATE_INTERVAL || "60", 10),
      model: process.env.SCRIBE_MODEL || defaultServiceModel,
    },
    tldr: {
      updateInterval: parseInt(process.env.TLDR_UPDATE_INTERVAL || "600", 10),
      model: process.env.TLDR_MODEL || defaultServiceModel,
    },
    sessionPlanner: {
      model:
        process.env.SESSION_PLANNER_MODEL ||
        (hasAnthropic ? "claude" : defaultServiceModel),
      timeoutMinutes: parseInt(
        process.env.SESSION_PLANNER_TIMEOUT_MINUTES || "30",
        10
      ),
      maxQuestions: parseInt(
        process.env.SESSION_PLANNER_MAX_QUESTIONS || "5",
        10
      ),
      autoStart: process.env.SESSION_PLANNER_AUTO_START === "true",
    },
    moderator: {
      checkInterval: parseInt(process.env.MODERATOR_CHECK_INTERVAL || "10", 10),
      topicDriftThreshold: parseFloat(
        process.env.MODERATOR_TOPIC_DRIFT_THRESHOLD || "0.6"
      ),
      maxDriftWarnings: parseInt(
        process.env.MODERATOR_MAX_DRIFT_WARNINGS || "3",
        10
      ),
      participantBalanceCheck:
        process.env.MODERATOR_PARTICIPANT_BALANCE_CHECK !== "false",
      qualityAssessment: process.env.MODERATOR_QUALITY_ASSESSMENT !== "false",
    },
    logLevel: process.env.LOG_LEVEL || "info",
    modelsConfig,
  };
}
