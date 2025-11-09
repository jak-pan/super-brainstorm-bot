import dotenv from "dotenv";
import type { Config } from "../types/index.js";
import { loadDefaultSettings } from "./settings-loader.js";

dotenv.config();

export function loadConfig(): Config {
  const requiredEnvVars = [
    "DISCORD_BOT_TOKEN",
    "DISCORD_GUILD_ID",
    "NOTION_API_KEY",
    "NOTION_PAGE_ID", // Single database/page ID
  ];

  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  // OpenRouter API key is required
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY is required. Get your API key from https://openrouter.ai/keys"
    );
  }

  // Load default settings from JSON
  const defaultSettings = loadDefaultSettings();

  return {
    discord: {
      token: process.env.DISCORD_BOT_TOKEN!,
      guildId: process.env.DISCORD_GUILD_ID!,
    },
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY!,
    },
    notion: {
      apiKey: process.env.NOTION_API_KEY!,
      databaseId: process.env.NOTION_PAGE_ID!, // Single database/page ID
    },
    limits: {
      maxMessagesPerConversation: defaultSettings.limits.maxMessagesPerConversation,
      maxContextWindowPercent: defaultSettings.limits.maxContextWindowPercent,
      contextRefreshThreshold: defaultSettings.limits.contextRefreshThreshold,
      conversationTimeoutMinutes: defaultSettings.limits.conversationTimeoutMinutes,
      maxAIResponsesPerTurn: defaultSettings.limits.maxAIResponsesPerTurn,
      batchReplyTimeWindowSeconds: defaultSettings.limits.batchReplyTimeWindowSeconds,
    },
    costLimits: {
      conversation: defaultSettings.costLimits.conversation,
      image: defaultSettings.costLimits.image,
    },
    scribe: {
      updateInterval: defaultSettings.scribe.updateInterval,
    },
    tldr: {
      updateInterval: defaultSettings.tldr.updateInterval,
    },
    sessionPlanner: {
      timeoutMinutes: defaultSettings.sessionPlanner.timeoutMinutes,
      maxQuestions: defaultSettings.sessionPlanner.maxQuestions,
      autoStart: defaultSettings.sessionPlanner.autoStart,
    },
    moderator: {
      checkInterval: defaultSettings.moderator.checkInterval,
      topicDriftThreshold: defaultSettings.moderator.topicDriftThreshold,
      maxDriftWarnings: defaultSettings.moderator.maxDriftWarnings,
      participantBalanceCheck: defaultSettings.moderator.participantBalanceCheck,
      qualityAssessment: defaultSettings.moderator.qualityAssessment,
    },
    logLevel: defaultSettings.logging.level,
    defaultSettings, // Include full settings for access
  };
}
