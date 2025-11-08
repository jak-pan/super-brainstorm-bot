import OpenAI from 'openai';
import { BaseAdapter } from './base-adapter.js';
import type { Message, AIResponse } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { retryWithBackoff } from '../utils/retry.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';

export class GrokAdapter extends BaseAdapter {
  private client: OpenAI;
  private model: string;
  private circuitBreaker: CircuitBreaker;

  constructor(apiKey: string, model: string, baseUrl: string) {
    super('Grok', 128000); // Estimate, verify with actual API docs
    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl,
    });
    this.model = model;
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 60000, // 1 minute
    });
  }

  /**
   * Generate a response using Grok API with retry logic and circuit breaker
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
          const formattedMessages = this.formatMessagesForAPI(context);
          
          const response = await this.client.chat.completions.create({
            model: this.model,
            messages: [
              { role: 'system', content: systemPrompt },
              ...formattedMessages,
            ],
            temperature: 0.7,
            max_tokens: 4000,
          });

          const content = response.choices[0]?.message?.content || '';
          const tokens = response.usage?.total_tokens || 0;

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
      logger.error('Grok API error:', error);
      throw new Error(`Grok API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
  }

  checkContextWindow(messages: Message[]): number {
    const totalTokens = messages.reduce((sum, msg) => {
      return sum + (msg.tokens || this.estimateTokens(msg.content));
    }, 0);
    return totalTokens;
  }

  formatMessagesForAPI(messages: Message[]): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    return messages.map((msg) => ({
      role: msg.authorType === 'user' ? 'user' : 'assistant',
      content: msg.content,
    } as { role: 'user' | 'assistant' | 'system'; content: string }));
  }
}

