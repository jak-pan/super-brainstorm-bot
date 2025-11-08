import type { Config } from "../types/index.js";
import type { AIAdapter } from "../types/index.js";
import { OpenRouterAdapter } from "./openrouter-adapter.js";
import { logger } from "../utils/logger.js";

/**
 * Adapter Registry
 *
 * Manages AI adapters using OpenRouter for unified access to all models.
 * Creates adapters on-demand based on model IDs (e.g., "openai/gpt-4o", "anthropic/claude-3-5-sonnet").
 */
export class AdapterRegistry {
  private adapters: Map<string, AIAdapter> = new Map();
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    // Adapters are now created on-demand via getAdapter()
    logger.info(
      "AdapterRegistry initialized - adapters will be created on-demand"
    );
  }

  /**
   * Get adapter by name or model ID
   * Creates a new adapter on-demand if model ID is provided and not cached
   */
  getAdapter(name: string): AIAdapter | undefined {
    // Check cache first
    const cached = this.adapters.get(name.toLowerCase());
    if (cached) return cached;

    // If it looks like an OpenRouter model ID (contains "/"), create adapter on-demand
    if (name.includes("/")) {
      try {
        const adapter = new OpenRouterAdapter(
          this.config.openrouter.apiKey,
          name
        );
        this.adapters.set(name.toLowerCase(), adapter);
        this.adapters.set(name, adapter);
        logger.info(`Created on-demand OpenRouter adapter: ${name}`);
        return adapter;
      } catch (error) {
        logger.error(`Failed to create adapter for ${name}:`, error);
        return undefined;
      }
    }

    return undefined;
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
