import type { Message, ConversationState, Config } from '../types/index.js';
import { NotionService } from './notion-service.js';
import { logger } from '../utils/logger.js';

/**
 * Context Manager - Manages conversation context and memory
 * 
 * Responsibilities:
 * - Track conversation history
 * - Monitor context window usage
 * - Trigger context refresh from Notion
 * - Compress context when needed
 * - Enforce conversation limits
 */
export class ContextManager {
  private notionService: NotionService;
  private config: Config;
  private conversations: Map<string, ConversationState> = new Map();

  /**
   * Create a new context manager
   * 
   * @param notionService - Service for Notion integration
   * @param config - Application configuration
   */
  constructor(notionService: NotionService, config: Config) {
    this.notionService = notionService;
    this.config = config;
  }

  /**
   * Get a conversation by ID
   * 
   * @param conversationId - The conversation ID
   * @returns The conversation state, or undefined if not found
   */
  getConversation(conversationId: string): ConversationState | undefined {
    return this.conversations.get(conversationId);
  }

  /**
   * Create a new conversation
   * 
   * @param conversationId - Unique conversation ID
   * @param channelId - Discord channel ID
   * @param topic - Conversation topic
   * @param participants - List of participant IDs
   * @returns The created conversation state
   */
  createConversation(
    conversationId: string,
    channelId: string,
    topic: string,
    participants: string[]
  ): ConversationState {
    const conversation: ConversationState = {
      id: conversationId,
      channelId,
      topic,
      participants,
      selectedModels: [], // Will be set during planning
      messages: [],
      contextWindow: {
        current: 0,
        max: 200000, // Use the largest context window (Claude)
        provider: 'claude',
      },
      status: 'active',
      createdAt: new Date(),
      lastActivity: new Date(),
      messageCount: 0,
      tokenCount: 0,
    };

    this.conversations.set(conversationId, conversation);
    return conversation;
  }

  /**
   * Add a message to a conversation
   * Updates message count, token count, and context window usage
   * 
   * @param conversationId - The conversation ID
   * @param message - The message to add
   * @throws Error if conversation not found
   */
  addMessage(conversationId: string, message: Message): void {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    conversation.messages.push(message);
    conversation.messageCount++;
    conversation.tokenCount += message.tokens || 0;
    conversation.lastActivity = new Date();

    // Update context window usage
    conversation.contextWindow.current = this.calculateContextUsage(conversation.messages);
  }

  /**
   * Refresh conversation context from Notion
   * Replaces old messages with compressed context and recent messages
   * 
   * @param conversationId - The conversation ID
   * @throws Error if conversation not found
   */
  async refreshContext(conversationId: string): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    const contextPercent = (conversation.contextWindow.current / conversation.contextWindow.max) * 100;
    
    if (contextPercent > this.config.limits.contextRefreshThreshold) {
      logger.info(`Refreshing context for conversation ${conversationId} (${contextPercent.toFixed(1)}% used)`);
      
      const compressedContext = await this.notionService.getCompressedContext(conversationId);
      
      if (compressedContext) {
        // Keep only recent messages and prepend compressed context
        const recentMessages = conversation.messages.slice(-10); // Keep last 10 messages
        const contextMessage: Message = {
          id: `context-${Date.now()}`,
          conversationId,
          authorId: 'system',
          authorType: 'user',
          content: `[Compressed Context from Previous Conversation]\n\n${compressedContext}`,
          replyTo: [],
          timestamp: new Date(),
          tokens: this.estimateTokens(compressedContext),
        };

        conversation.messages = [contextMessage, ...recentMessages];
        conversation.contextWindow.current = this.calculateContextUsage(conversation.messages);
        
        logger.info(`Context refreshed for conversation ${conversationId}`);
      }
    }
  }

  /**
   * Check if context should be refreshed based on usage threshold
   * 
   * @param conversationId - The conversation ID
   * @returns True if context usage exceeds threshold
   */
  shouldRefreshContext(conversationId: string): boolean {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return false;

    const contextPercent = (conversation.contextWindow.current / conversation.contextWindow.max) * 100;
    return contextPercent > this.config.limits.contextRefreshThreshold;
  }

  /**
   * Check if conversation has exceeded any limits
   * 
   * @param conversationId - The conversation ID
   * @returns Object indicating if limits exceeded and reason
   */
  checkLimits(conversationId: string): { exceeded: boolean; reason?: string } {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return { exceeded: true, reason: 'Conversation not found' };
    }

    // Check message count
    if (conversation.messageCount >= this.config.limits.maxMessagesPerConversation) {
      return { exceeded: true, reason: 'Maximum message count reached' };
    }

    // Check token count
    if (conversation.tokenCount >= this.config.limits.maxTokensPerConversation) {
      return { exceeded: true, reason: 'Maximum token count reached' };
    }

    // Check context window
    const contextPercent = (conversation.contextWindow.current / conversation.contextWindow.max) * 100;
    if (contextPercent >= this.config.limits.maxContextWindowPercent) {
      return { exceeded: true, reason: 'Context window limit reached' };
    }

    // Check timeout
    const timeoutMs = this.config.limits.conversationTimeoutMinutes * 60 * 1000;
    const timeSinceLastActivity = Date.now() - conversation.lastActivity.getTime();
    if (timeSinceLastActivity > timeoutMs) {
      return { exceeded: true, reason: 'Conversation timeout' };
    }

    return { exceeded: false };
  }

  getMessages(conversationId: string): Message[] {
    const conversation = this.conversations.get(conversationId);
    return conversation?.messages || [];
  }

  updateStatus(conversationId: string, status: ConversationState['status']): void {
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      conversation.status = status;
    }
  }

  private calculateContextUsage(messages: Message[]): number {
    return messages.reduce((sum, msg) => {
      return sum + (msg.tokens || this.estimateTokens(msg.content));
    }, 0);
  }

  private estimateTokens(text: string): number {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }
}

