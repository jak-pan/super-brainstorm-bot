import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ModelInfo, ModelsConfig } from '../types/index.js';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let modelsConfig: ModelsConfig | null = null;

/**
 * Load models configuration from JSON file
 */
export function loadModelsConfig(): ModelsConfig {
  if (modelsConfig) {
    return modelsConfig;
  }

  try {
    const configPath = join(__dirname, '../config/models.json');
    const configData = readFileSync(configPath, 'utf-8');
    modelsConfig = JSON.parse(configData) as ModelsConfig;
    logger.info('Models configuration loaded');
    return modelsConfig;
  } catch (error) {
    logger.error('Failed to load models configuration:', error);
    throw new Error('Failed to load models configuration');
  }
}

/**
 * Get model information by provider and model ID
 */
export function getModelInfo(provider: 'openai' | 'anthropic' | 'grok', modelId: string): ModelInfo | null {
  const config = loadModelsConfig();
  const providerConfig = config[provider];
  if (!providerConfig) return null;

  return providerConfig.models.find(m => m.id === modelId) || null;
}

/**
 * Get the smartest model for a provider
 */
export function getSmartestModel(provider: 'openai' | 'anthropic' | 'grok'): string | null {
  const config = loadModelsConfig();
  const providerConfig = config[provider];
  if (!providerConfig) return null;

  return providerConfig.smartestModel;
}

/**
 * Get default model for a provider
 */
export function getDefaultModel(provider: 'openai' | 'anthropic' | 'grok'): string | null {
  const config = loadModelsConfig();
  const providerConfig = config[provider];
  if (!providerConfig) return null;

  return providerConfig.defaultModel;
}

/**
 * Get all available models for a provider
 */
export function getAvailableModels(provider: 'openai' | 'anthropic' | 'grok'): ModelInfo[] {
  const config = loadModelsConfig();
  const providerConfig = config[provider];
  if (!providerConfig) return [];

  return providerConfig.models.filter(m => m.available);
}

/**
 * Calculate cost for a model based on input and output tokens
 */
export function calculateCost(
  provider: 'openai' | 'anthropic' | 'grok',
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const modelInfo = getModelInfo(provider, modelId);
  if (!modelInfo || !modelInfo.pricing) {
    logger.warn(`No pricing info for ${provider}/${modelId}, using fallback`);
    // Fallback pricing (average)
    return (inputTokens / 1000) * 0.002 + (outputTokens / 1000) * 0.01;
  }

  const { input, output } = modelInfo.pricing;
  
  // Pricing is per 1k tokens
  const inputCost = (inputTokens / 1000) * input;
  const outputCost = (outputTokens / 1000) * output;
  
  return inputCost + outputCost;
}

/**
 * Get cost breakdown for a model
 */
export function getCostBreakdown(
  provider: 'openai' | 'anthropic' | 'grok',
  modelId: string,
  inputTokens: number,
  outputTokens: number
): {
  inputCost: number;
  outputCost: number;
  totalCost: number;
} {
  const modelInfo = getModelInfo(provider, modelId);
  if (!modelInfo || !modelInfo.pricing) {
    // Fallback
    const inputCost = (inputTokens / 1000) * 0.002;
    const outputCost = (outputTokens / 1000) * 0.01;
    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
    };
  }

  const { input, output } = modelInfo.pricing;
  const inputCost = (inputTokens / 1000) * input;
  const outputCost = (outputTokens / 1000) * output;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}

/**
 * Get all smartest models from available providers
 */
export function getSmartestModelsFromAvailable(availableProviders: ('openai' | 'anthropic' | 'grok')[]): string[] {
  return availableProviders
    .map(provider => getSmartestModel(provider))
    .filter((model): model is string => model !== null);
}

