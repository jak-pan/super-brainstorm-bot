import type { AIAdapter, Message, AIResponse } from '../types/index.js';
import { encoding_for_model } from 'tiktoken';

export abstract class BaseAdapter implements AIAdapter {
  protected modelName: string;
  protected maxContextWindow: number;

  constructor(modelName: string, maxContextWindow: number) {
    this.modelName = modelName;
    this.maxContextWindow = maxContextWindow;
  }

  abstract generateResponse(
    context: Message[],
    systemPrompt: string,
    replyTo?: string[]
  ): Promise<AIResponse>;

  abstract checkContextWindow(messages: Message[]): number;

  getModelName(): string {
    return this.modelName;
  }

  getMaxContextWindow(): number {
    return this.maxContextWindow;
  }

  estimateTokens(text: string): number {
    try {
      // Use cl100k_base encoding (used by GPT-4 and Claude)
      const encoding = encoding_for_model('gpt-4');
      const tokens = encoding.encode(text);
      encoding.free();
      return tokens.length;
    } catch (error) {
      // Fallback: rough estimation (1 token ≈ 4 characters)
      return Math.ceil(text.length / 4);
    }
  }

  protected formatMessagesForAPI(messages: Message[]): Array<{ role: string; content: string }> {
    return messages.map((msg) => ({
      role: msg.authorType === 'user' ? 'user' : 'assistant',
      content: msg.content,
    }));
  }
}

