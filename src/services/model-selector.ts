/**
 * Model Selector Service
 *
 * Provides smart model selection based on task type and allows dynamic model configuration.
 * Supports task-based presets (general vs coding/architecture) and custom model selection.
 * Model presets are loaded from default-settings.json
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type TaskType = "general" | "coding" | "architecture";

export interface ModelPreset {
  conversationModels: string[]; // Models to use in conversation
  scribeModel: string; // Model for Scribe bot
  tldrModel: string; // Model for TLDR bot
}

interface SettingsConfig {
  models: {
    presets: Record<TaskType, ModelPreset>;
    imageModels: string[];
  };
}

let settingsCache: SettingsConfig | null = null;

/**
 * Load settings from default-settings.json
 */
function loadSettings(): SettingsConfig {
  if (settingsCache) {
    return settingsCache;
  }

  try {
    const settingsPath = join(__dirname, "../config/default-settings.json");
    const settingsData = readFileSync(settingsPath, "utf-8");
    settingsCache = JSON.parse(settingsData) as SettingsConfig;
    return settingsCache;
  } catch (error) {
    throw new Error(
      `Failed to load default-settings.json: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Get model presets from settings
 */
export function getModelPresets(): Record<TaskType, ModelPreset> {
  const settings = loadSettings();
  return settings.models.presets;
}

/**
 * Get image models from settings
 */
export function getImageModels(): string[] {
  const settings = loadSettings();
  return settings.models.imageModels;
}

/**
 * Smart model presets based on task type (loaded from settings)
 */
export const MODEL_PRESETS: Record<TaskType, ModelPreset> = getModelPresets();

/**
 * Detect task type from message content
 */
export function detectTaskType(message: string): TaskType {
  const lowerMessage = message.toLowerCase();

  // Coding keywords
  const codingKeywords = [
    "code",
    "programming",
    "function",
    "class",
    "method",
    "variable",
    "algorithm",
    "syntax",
    "debug",
    "compile",
    "repository",
    "git",
    "api",
    "endpoint",
    "database",
    "sql",
    "javascript",
    "typescript",
    "python",
    "react",
    "node",
    "framework",
    "library",
    "package",
  ];

  // Architecture keywords
  const architectureKeywords = [
    "architecture",
    "design",
    "system design",
    "microservices",
    "scalability",
    "infrastructure",
    "deployment",
    "kubernetes",
    "docker",
    "aws",
    "cloud",
    "serverless",
    "database design",
    "schema",
    "erd",
    "diagram",
    "component",
    "service",
    "api design",
  ];

  const codingScore = codingKeywords.filter((keyword) =>
    lowerMessage.includes(keyword)
  ).length;

  const architectureScore = architectureKeywords.filter((keyword) =>
    lowerMessage.includes(keyword)
  ).length;

  if (architectureScore > 0 && architectureScore >= codingScore) {
    return "architecture";
  }

  if (codingScore > 0) {
    return "coding";
  }

  return "general";
}

/**
 * Get model preset for a task type
 */
export function getModelPreset(taskType: TaskType): ModelPreset {
  return MODEL_PRESETS[taskType];
}

/**
 * Validate model ID format (should be "provider/model-id")
 */
export function isValidModelId(modelId: string): boolean {
  return /^[a-z0-9-]+\/[a-z0-9-]+$/i.test(modelId);
}

/**
 * Get default preset (general)
 */
export function getDefaultPreset(): ModelPreset {
  return MODEL_PRESETS.general;
}
