import type { Message, AIResponse, AIAdapter, Config } from "../types/index.js";
import { ContextManager } from "./context-manager.js";
import { logger } from "../utils/logger.js";
import { PromptLoader } from "../utils/prompt-loader.js";
// Cost is now provided directly by OpenRouter API, no manual calculation needed
import { AdapterRegistry } from "../adapters/index.js";
import PQueue from "p-queue";

/**
 * Callback function for posting AI responses to Discord
 */
export type ResponseCallback = (
  response: AIResponse & { conversationId: string }
) => Promise<void>;

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
  private adapterRegistry: AdapterRegistry;
  private config: Config;
  private responseQueue: PQueue;
  private recentMessages: Map<
    string,
    { message: Message; timestamp: number }[]
  > = new Map();
  private responseCallback?: ResponseCallback;

  /**
   * Create a new conversation coordinator
   *
   * @param contextManager - Manager for conversation context
   * @param adapterRegistry - Registry for creating adapters on-demand
   * @param config - Application configuration
   * @param responseCallback - Optional callback for posting responses
   */
  constructor(
    contextManager: ContextManager,
    adapterRegistry: AdapterRegistry,
    config: Config,
    responseCallback?: ResponseCallback
  ) {
    this.contextManager = contextManager;
    this.adapterRegistry = adapterRegistry;
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
  async handleNewMessage(
    conversationId: string,
    message: Message
  ): Promise<void> {
    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation || conversation.status !== "active") {
      return;
    }

    // Check cost limit
    const costLimit =
      conversation.costLimit || this.config.costLimits.conversation;
    const currentCost = conversation.costTracking?.totalCost || 0;
    if (currentCost >= costLimit) {
      logger.warn(
        `Conversation ${conversationId} reached cost limit: $${currentCost.toFixed(
          2
        )} / $${costLimit}`
      );
      this.contextManager.updateStatus(conversationId, "paused");
      return;
    }

    // Check limits
    const limits = this.contextManager.checkLimits(conversationId);
    if (limits.exceeded) {
      logger.warn(
        `Conversation ${conversationId} exceeded limits: ${limits.reason}`
      );
      this.contextManager.updateStatus(conversationId, "stopped");
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
    if (message.authorType === "user") {
      return true;
    }

    // AIs can respond to other AIs, but limit the depth
    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) return false;

    // Count recent AI responses
    const recentAIResponses = conversation.messages
      .slice(-this.config.limits.maxAIResponsesPerTurn)
      .filter((m) => m.authorType === "ai").length;

    return recentAIResponses < this.config.limits.maxAIResponsesPerTurn;
  }

  private async triggerAIResponses(
    conversationId: string,
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
        return (
          timeDiff <= this.config.limits.batchReplyTimeWindowSeconds * 1000
        );
      })
      .map((r) => r.message.id)
      .slice(0, 5); // Max 5 message references

    // Get adapters for selected models, excluding disabled agents
    const selectedModels = conversation.selectedModels || [];
    const disabledAgents = conversation.disabledAgents || [];
    const activeModels = selectedModels.filter(
      (modelId) => !disabledAgents.includes(modelId)
    );

    // Track active agents
    if (!conversation.activeAgents) {
      conversation.activeAgents = [];
    }
    activeModels.forEach((modelId) => {
      if (!conversation.activeAgents!.includes(modelId)) {
        conversation.activeAgents!.push(modelId);
      }
    });

    // Get adapters for active models
    const availableAdapters: AIAdapter[] = [];
    for (const modelId of activeModels) {
      const adapter = this.adapterRegistry.getAdapter(modelId);
      if (adapter) {
        availableAdapters.push(adapter);
      }
    }

    if (availableAdapters.length === 0) {
      logger.warn(`No active adapters for conversation ${conversationId}`);
      return;
    }

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
          logger.error(
            `Error generating response from ${adapter.getModelName()}:`,
            error
          );
          return null;
        }
      })
    );

    const responses = await Promise.all(responsePromises);

    // Filter out null responses (failed)
    const validResponses = responses.filter((r): r is AIResponse => r !== null);

    logger.info(
      `Generated ${validResponses.length} AI responses for conversation ${conversationId}`
    );

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
  ): Promise<AIResponse | null> {
    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) return null;

    // Check cost limit before generating response
    const costLimit =
      conversation.costLimit || this.config.costLimits.conversation;
    const currentCost = conversation.costTracking?.totalCost || 0;
    if (currentCost >= costLimit) {
      logger.warn(
        `Cost limit reached for conversation ${conversationId}, pausing`
      );
      this.contextManager.updateStatus(conversationId, "paused");
      return null;
    }

    const systemPrompt = this.buildSystemPrompt(conversationId);

    const response = await adapter.generateResponse(
      messages,
      systemPrompt,
      replyTo
    );

    // Use cost directly from OpenRouter API response (in USD)
    const cost = response.cost || 0;
    const modelId = response.model; // OpenRouter model ID

    // Update cost tracking
    if (!conversation.costTracking) {
      conversation.costTracking = {
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        costsByModel: {},
      };
    }

    conversation.costTracking.totalCost += cost;
    conversation.costTracking.totalInputTokens += response.inputTokens;
    conversation.costTracking.totalOutputTokens += response.outputTokens;

    if (!conversation.costTracking.costsByModel[modelId]) {
      conversation.costTracking.costsByModel[modelId] = {
        cost: 0,
        inputTokens: 0,
        outputTokens: 0,
        requestCount: 0,
      };
    }

    conversation.costTracking.costsByModel[modelId].cost += cost;
    conversation.costTracking.costsByModel[modelId].inputTokens +=
      response.inputTokens;
    conversation.costTracking.costsByModel[modelId].outputTokens +=
      response.outputTokens;
    conversation.costTracking.costsByModel[modelId].requestCount += 1;

    // Check if we've exceeded cost limit after this response
    if (conversation.costTracking.totalCost >= costLimit) {
      logger.warn(
        `Cost limit reached after response: $${conversation.costTracking.totalCost.toFixed(
          2
        )} / $${costLimit}`
      );
      this.contextManager.updateStatus(conversationId, "paused");
    }

    // Add cost to response
    response.cost = cost;
    response.costBreakdown = {
      inputCost: (response.inputTokens / 1000) * 0.002, // Will be more accurate with actual pricing
      outputCost: (response.outputTokens / 1000) * 0.01,
      totalCost: cost,
    };

    // Create message from response
    const message: Message = {
      id: `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      conversationId,
      authorId: adapter.getModelName(),
      authorType: "ai",
      content: response.content,
      replyTo: response.replyTo,
      timestamp: new Date(),
      model: modelId,
      tokens: response.tokens,
    };

    // Add to context
    this.contextManager.addMessage(conversationId, message);

    return response;
  }

  private buildSystemPrompt(conversationId: string): string {
    const conversation = this.contextManager.getConversation(conversationId);
    const topic = conversation?.topic || "general discussion";

    return PromptLoader.loadPrompt("conversation-coordinator.txt", { topic });
  }

  getAIResponse(
    conversationId: string,
    modelId: string
  ): Promise<AIResponse | null> {
    const adapter = this.adapterRegistry.getAdapter(modelId);
    if (!adapter) {
      logger.warn(`Adapter for model ${modelId} not found`);
      return Promise.resolve(null);
    }

    const messages = this.contextManager.getMessages(conversationId);

    return this.generateAIResponse(conversationId, adapter, messages, []);
  }
}
