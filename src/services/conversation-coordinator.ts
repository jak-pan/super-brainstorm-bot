import type { Message, AIResponse, AIAdapter, Config } from '../types/index.js';
import { ContextManager } from './context-manager.js';
import { logger } from '../utils/logger.js';
import { PromptLoader } from '../utils/prompt-loader.js';
import PQueue from 'p-queue';

/**
 * Callback function for posting AI responses to Discord
 */
export type ResponseCallback = (response: AIResponse & { conversationId: string }) => Promise<void>;

/**
 * Conversation Coordinator - Orchestrates multi-AI conversations
 * 
 * Responsibilities:
 * - Track conversation threads
 * - Manage turn-taking logic
 * - Detect when AIs should respond
 * - Queue and batch AI responses
 * - Handle context window management
 * - Implement conversation limits
 */
export class ConversationCoordinator {
  private contextManager: ContextManager;
  private adapters: Map<string, AIAdapter>;
  private config: Config;
  private responseQueue: PQueue;
  private recentMessages: Map<string, { message: Message; timestamp: number }[]> = new Map();
  private responseCallback?: ResponseCallback;

  /**
   * Create a new conversation coordinator
   * 
   * @param contextManager - Manager for conversation context
   * @param adapters - Map of available AI adapters
   * @param config - Application configuration
   * @param responseCallback - Optional callback for posting responses
   */
  constructor(
    contextManager: ContextManager,
    adapters: Map<string, AIAdapter>,
    config: Config,
    responseCallback?: ResponseCallback
  ) {
    this.contextManager = contextManager;
    this.adapters = adapters;
    this.config = config;
    this.responseQueue = new PQueue({ concurrency: 3 }); // Process up to 3 AI responses in parallel
    this.responseCallback = responseCallback;
  }

  /**
   * Handle a new message in a conversation
   * Checks limits, refreshes context if needed, and triggers AI responses
   * 
   * @param conversationId - The conversation ID
   * @param message - The new message
   */
  async handleNewMessage(conversationId: string, message: Message): Promise<void> {
    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation || conversation.status !== 'active') {
      return;
    }

    // Check limits
    const limits = this.contextManager.checkLimits(conversationId);
    if (limits.exceeded) {
      logger.warn(`Conversation ${conversationId} exceeded limits: ${limits.reason}`);
      this.contextManager.updateStatus(conversationId, 'stopped');
      return;
    }

    // Refresh context if needed
    if (this.contextManager.shouldRefreshContext(conversationId)) {
      await this.contextManager.refreshContext(conversationId);
    }

    // Add message to context
    this.contextManager.addMessage(conversationId, message);

    // Track recent messages for batching
    if (!this.recentMessages.has(conversationId)) {
      this.recentMessages.set(conversationId, []);
    }
    const recent = this.recentMessages.get(conversationId)!;
    recent.push({ message, timestamp: Date.now() });

    // Clean old messages (older than batch window)
    const windowMs = this.config.limits.batchReplyTimeWindowSeconds * 1000;
    const cutoff = Date.now() - windowMs;
    this.recentMessages.set(
      conversationId,
      recent.filter((r) => r.timestamp > cutoff)
    );

    // Determine which AIs should respond
    const shouldRespond = this.shouldAIsRespond(message, conversationId);
    
    if (shouldRespond) {
      await this.triggerAIResponses(conversationId, message);
    }
  }

  private shouldAIsRespond(message: Message, conversationId: string): boolean {
    // AIs respond to user messages, not to other AIs (to avoid loops)
    // But we can configure this behavior
    if (message.authorType === 'user') {
      return true;
    }

    // AIs can respond to other AIs, but limit the depth
    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) return false;

    // Count recent AI responses
    const recentAIResponses = conversation.messages
      .slice(-this.config.limits.maxAIResponsesPerTurn)
      .filter((m) => m.authorType === 'ai').length;

    return recentAIResponses < this.config.limits.maxAIResponsesPerTurn;
  }

  private async triggerAIResponses(
    conversationId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _triggerMessage: Message
  ): Promise<void> {
    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) return;

    const messages = this.contextManager.getMessages(conversationId);
    const recent = this.recentMessages.get(conversationId) || [];
    
    // Determine which messages to reply to (for batching)
    const replyTo = recent
      .filter((r) => {
        const timeDiff = Date.now() - r.timestamp;
        return timeDiff <= this.config.limits.batchReplyTimeWindowSeconds * 1000;
      })
      .map((r) => r.message.id)
      .slice(0, 5); // Max 5 message references

    // Get available adapters (excluding the one that just responded if it was an AI)
    const availableAdapters = Array.from(this.adapters.values());
    
    // Limit number of responses per turn
    const maxResponses = this.config.limits.maxAIResponsesPerTurn;
    const adaptersToUse = availableAdapters.slice(0, maxResponses);

    // Generate responses in parallel
    const responsePromises = adaptersToUse.map((adapter) =>
      this.responseQueue.add(async () => {
        try {
          return await this.generateAIResponse(
            conversationId,
            adapter,
            messages,
            replyTo
          );
        } catch (error) {
          logger.error(`Error generating response from ${adapter.getModelName()}:`, error);
          return null;
        }
      })
    );

    const responses = await Promise.all(responsePromises);
    
    // Filter out null responses (failed)
    const validResponses = responses.filter((r): r is AIResponse => r !== null);
    
    logger.info(`Generated ${validResponses.length} AI responses for conversation ${conversationId}`);
    
    // Post responses to Discord if callback is provided
    if (this.responseCallback) {
      for (const response of validResponses) {
        try {
          await this.responseCallback({ ...response, conversationId });
        } catch (error) {
          logger.error(`Error posting response to Discord:`, error);
        }
      }
    }
    
    return Promise.resolve();
  }

  private async generateAIResponse(
    conversationId: string,
    adapter: AIAdapter,
    messages: Message[],
    replyTo: string[]
  ): Promise<AIResponse> {
    const systemPrompt = this.buildSystemPrompt(conversationId);
    
    const response = await adapter.generateResponse(messages, systemPrompt, replyTo);
    
    // Create message from response
    const message: Message = {
      id: `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      conversationId,
      authorId: adapter.getModelName(),
      authorType: 'ai',
      content: response.content,
      replyTo: response.replyTo,
      timestamp: new Date(),
      model: adapter.getModelName(),
      tokens: response.tokens,
    };

    // Add to context
    this.contextManager.addMessage(conversationId, message);

    return response;
  }

  private buildSystemPrompt(conversationId: string): string {
    const conversation = this.contextManager.getConversation(conversationId);
    const topic = conversation?.topic || 'general discussion';
    
    return PromptLoader.loadPrompt('conversation-coordinator.txt', { topic });
  }

  getAIResponse(conversationId: string, adapterName: string): Promise<AIResponse | null> {
    const adapter = this.adapters.get(adapterName.toLowerCase());
    if (!adapter) {
      logger.warn(`Adapter ${adapterName} not found`);
      return Promise.resolve(null);
    }

    const messages = this.contextManager.getMessages(conversationId);

    return this.generateAIResponse(conversationId, adapter, messages, []);
  }
}

