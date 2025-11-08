import { BaseAdapter } from './base-adapter.js';
import type { Message, AIResponse } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * Cursor Adapter - Placeholder implementation
 * Note: Cursor may not have a public API. This is a placeholder
 * that can be implemented if/when the API becomes available.
 */
export class CursorAdapter extends BaseAdapter {
  private apiKey?: string;
  private model?: string;
  private baseUrl?: string;

  constructor(apiKey?: string, model?: string, baseUrl?: string) {
    super('Cursor', 128000); // Estimate, verify with actual API docs
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async generateResponse(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _context: Message[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _systemPrompt: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _replyTo?: string[]
  ): Promise<AIResponse> {
    if (!this.apiKey || !this.model || !this.baseUrl) {
      throw new Error('Cursor API not configured. API key, model, and base URL are required.');
    }

    // TODO: Implement when Cursor API becomes available
    logger.warn('Cursor adapter called but not fully implemented');
    throw new Error('Cursor API adapter not yet implemented. Please check if Cursor has a public API.');
  }

  checkContextWindow(messages: Message[]): number {
    const totalTokens = messages.reduce((sum, msg) => {
      return sum + (msg.tokens || this.estimateTokens(msg.content));
    }, 0);
    return totalTokens;
  }
}

