import type { Config } from '../types/index.js';
import type { AIAdapter } from '../types/index.js';
import { OpenAIAdapter } from './openai-adapter.js';
import { AnthropicAdapter } from './anthropic-adapter.js';
import { GrokAdapter } from './grok-adapter.js';
import { logger } from '../utils/logger.js';

export class AdapterRegistry {
  private adapters: Map<string, AIAdapter> = new Map();

  constructor(config: Config) {
    // OpenAI
    try {
      const openaiAdapter = new OpenAIAdapter(config.openai.apiKey, config.openai.model);
      this.adapters.set('chatgpt', openaiAdapter);
      this.adapters.set('openai', openaiAdapter);
      logger.info('OpenAI adapter registered');
    } catch (error) {
      logger.error('Failed to register OpenAI adapter:', error);
    }

    // Anthropic
    try {
      const anthropicAdapter = new AnthropicAdapter(config.anthropic.apiKey, config.anthropic.model);
      this.adapters.set('claude', anthropicAdapter);
      this.adapters.set('anthropic', anthropicAdapter);
      logger.info('Anthropic adapter registered');
    } catch (error) {
      logger.error('Failed to register Anthropic adapter:', error);
    }

    // Grok
    if (config.grok.apiKey) {
      try {
        const grokAdapter = new GrokAdapter(
          config.grok.apiKey,
          config.grok.model,
          config.grok.baseUrl
        );
        this.adapters.set('grok', grokAdapter);
        logger.info('Grok adapter registered');
      } catch (error) {
        logger.error('Failed to register Grok adapter:', error);
      }
    }
  }

  getAdapter(name: string): AIAdapter | undefined {
    return this.adapters.get(name.toLowerCase());
  }

  getAllAdapters(): AIAdapter[] {
    return Array.from(this.adapters.values());
  }

  getAvailableAdapters(): string[] {
    return Array.from(this.adapters.keys());
  }

  hasAdapter(name: string): boolean {
    return this.adapters.has(name.toLowerCase());
  }
}

