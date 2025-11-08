import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface DefaultSettings {
  models: {
    presets: {
      general: {
        conversationModels: string[];
        scribeModel: string;
        tldrModel: string;
      };
      coding: {
        conversationModels: string[];
        scribeModel: string;
        tldrModel: string;
      };
      architecture: {
        conversationModels: string[];
        scribeModel: string;
        tldrModel: string;
      };
    };
    imageModels: string[];
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
  logging: {
    level: string;
  };
}

let settingsCache: DefaultSettings | null = null;

/**
 * Load default settings from JSON file
 */
export function loadDefaultSettings(): DefaultSettings {
  if (settingsCache) {
    return settingsCache;
  }

  try {
    const settingsPath = join(__dirname, "default-settings.json");
    const settingsData = readFileSync(settingsPath, "utf-8");
    settingsCache = JSON.parse(settingsData) as DefaultSettings;
    logger.info("Default settings loaded from default-settings.json");
    return settingsCache;
  } catch (error) {
    logger.error("Failed to load default-settings.json:", error);
    throw new Error(
      `Failed to load default-settings.json: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Reload settings from JSON file (useful for /sbb settings command)
 */
export function reloadDefaultSettings(): DefaultSettings {
  settingsCache = null;
  return loadDefaultSettings();
}

/**
 * Update settings in JSON file
 */
export async function updateDefaultSettings(
  updates: Partial<DefaultSettings>
): Promise<void> {
  const currentSettings = loadDefaultSettings();
  const updatedSettings: DefaultSettings = {
    ...currentSettings,
    ...updates,
    models: {
      ...currentSettings.models,
      ...(updates.models || {}),
      presets: {
        ...currentSettings.models.presets,
        ...(updates.models?.presets || {}),
      },
    },
    limits: {
      ...currentSettings.limits,
      ...(updates.limits || {}),
    },
    costLimits: {
      ...currentSettings.costLimits,
      ...(updates.costLimits || {}),
    },
    scribe: {
      ...currentSettings.scribe,
      ...(updates.scribe || {}),
    },
    tldr: {
      ...currentSettings.tldr,
      ...(updates.tldr || {}),
    },
    sessionPlanner: {
      ...currentSettings.sessionPlanner,
      ...(updates.sessionPlanner || {}),
    },
    moderator: {
      ...currentSettings.moderator,
      ...(updates.moderator || {}),
    },
    logging: {
      ...currentSettings.logging,
      ...(updates.logging || {}),
    },
  };

  const { writeFileSync } = await import("fs");
  const settingsPath = join(__dirname, "default-settings.json");
  writeFileSync(
    settingsPath,
    JSON.stringify(updatedSettings, null, 2),
    "utf-8"
  );
  settingsCache = updatedSettings;
  logger.info("Default settings updated");
}
