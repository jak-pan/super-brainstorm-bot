import Anthropic from '@anthropic-ai/sdk';
import { BaseAdapter } from './base-adapter.js';
import type { Message, AIResponse } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { retryWithBackoff } from '../utils/retry.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';

export class AnthropicAdapter extends BaseAdapter {
  private client: Anthropic;
  private model: string;
  private circuitBreaker: CircuitBreaker;

  constructor(apiKey: string, model: string) {
    super('Claude', 200000); // Claude 3 Opus has 200k context window
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 60000, // 1 minute
    });
  }

  /**
   * Generate a response using Anthropic API with retry logic and circuit breaker
   * 
   * @param context - Conversation messages
   * @param systemPrompt - System prompt for the AI
   * @param replyTo - Optional message IDs to reply to
   * @returns AI response with content, tokens, and metadata
   * @throws Error if API call fails after all retries
   */
  async generateResponse(
    context: Message[],
    systemPrompt: string,
    replyTo?: string[]
  ): Promise<AIResponse> {
    return this.circuitBreaker.execute(async () => {
      return retryWithBackoff(
        async () => {
          const messages = context.map((msg) => ({
            role: msg.authorType === 'user' ? 'user' : 'assistant',
            content: msg.content,
          })) as Array<{ role: 'user' | 'assistant'; content: string }>;

          const response = await this.client.messages.create({
            model: this.model,
            max_tokens: 4096,
            system: systemPrompt,
            messages,
          });

          const content = response.content[0]?.type === 'text' ? response.content[0].text : '';
          const tokens = response.usage.input_tokens + response.usage.output_tokens;

          return {
            content,
            model: this.modelName,
            tokens,
            replyTo: replyTo || [],
            contextUsed: tokens,
          };
        },
        {
          maxRetries: 3,
          initialDelay: 1000,
          retryableErrors: ['rate_limit', 'timeout', 'network', 'ECONNRESET', 'ETIMEDOUT'],
        }
      );
    }).catch((error) => {
      logger.error('Anthropic API error:', error);
      throw new Error(`Anthropic API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
  }

  checkContextWindow(messages: Message[]): number {
    const totalTokens = messages.reduce((sum, msg) => {
      return sum + (msg.tokens || this.estimateTokens(msg.content));
    }, 0);
    return totalTokens;
  }
}

