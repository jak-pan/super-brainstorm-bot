import type { Message, Config } from "../types/index.js";
import { ContextManager } from "./context-manager.js";
import { AdapterRegistry } from "../adapters/index.js";
import { logger } from "../utils/logger.js";
import { PromptLoader } from "../utils/prompt-loader.js";

/**
 * Callback function for posting planner/moderator messages to Discord
 */
export type PlannerCallback = (
  message: string,
  replyTo?: string,
  conversationId?: string
) => Promise<void>;

/**
 * Session Planner Bot (Session Moderator) - Plans, moderates, and oversees conversations
 *
 * Responsibilities:
 * - Planning Phase:
 *   * Analyze initial messages
 *   * Generate clarifying questions
 *   * Assess conversation parameters
 *   * Create conversation plans
 *   * Wait for approval
 * - Moderation Phase:
 *   * Monitor all messages
 *   * Detect topic drift
 *   * Steer conversations back on track
 *   * Monitor limits and timeouts
 *   * Assess conversation quality
 *   * Gracefully terminate conversations
 */
export class SessionPlanner {
  private adapterRegistry: AdapterRegistry;
  private contextManager: ContextManager;
  private config: Config;
  private planningTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private messageCallback?: PlannerCallback;
  private readonly defaultModel = "anthropic/claude-opus-4.1"; // Default model for session planner
  private planningInProgress: Set<string> = new Set(); // Track conversations currently being planned

  /**
   * Create a new session planner
   *
   * @param adapterRegistry - Registry of AI adapters
   * @param contextManager - Manager for conversation context
   * @param config - Application configuration
   * @param messageCallback - Optional callback for posting messages to Discord
   */
  constructor(
    adapterRegistry: AdapterRegistry,
    contextManager: ContextManager,
    config: Config,
    messageCallback?: PlannerCallback
  ) {
    this.adapterRegistry = adapterRegistry;
    this.contextManager = contextManager;
    this.config = config;
    this.messageCallback = messageCallback;
  }

  /**
   * Handle initial message - start planning phase
   * Analyzes the message and generates clarifying questions if needed
   * Returns a promise that resolves when plan is created or questions are asked
   *
   * @param conversationId - The conversation ID
   * @param message - The initial message
   * @returns Promise that resolves with { type: 'plan' | 'questions', ... }
   * @throws Error if conversation not found
   */
  async handleInitialMessage(
    conversationId: string,
    message: Message
  ): Promise<{
    type: "plan" | "questions";
    plan?: string;
    questions?: string[];
  }> {
    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    // Check if planning is already in progress for this conversation
    if (this.planningInProgress.has(conversationId)) {
      logger.warn(
        `Planning already in progress for conversation ${conversationId}, skipping duplicate call`
      );
      // Return existing state if available
      if (conversation.planningState?.plan) {
        return {
          type: "plan",
          plan: conversation.planningState.plan,
        };
      }
      if (conversation.planningState?.questions.length) {
        return {
          type: "questions",
          questions: conversation.planningState.questions,
        };
      }
      // Planning in progress but no result yet
      return {
        type: "questions",
        questions: [],
      };
    }

    // If planning has already started, return existing state
    if (conversation.status === "planning" && conversation.planningState) {
      // If plan already exists, return it
      if (conversation.planningState.plan) {
        return {
          type: "plan",
          plan: conversation.planningState.plan,
        };
      }
      // If questions were already asked, return them
      if (conversation.planningState.questions.length > 0) {
        return {
          type: "questions",
          questions: conversation.planningState.questions,
        };
      }
    }

    // Mark planning as in progress
    this.planningInProgress.add(conversationId);

    // Set status to planning
    this.contextManager.updateStatus(conversationId, "planning");

    // Initialize planning state
    const planningState = {
      questions: [],
      awaitingApproval: false,
      planningStartedAt: new Date(),
    };

    // Update conversation with planning state
    if (conversation) {
      conversation.planningState = planningState;
    }

    try {
      // Analyze message and generate questions - returns result
      const result = await this.analyzeAndAskQuestions(conversationId, message);

      // Set timeout for planning phase
      this.setPlanningTimeout(conversationId);

      return result;
    } finally {
      // Remove from in-progress set
      this.planningInProgress.delete(conversationId);
    }
  }

  /**
   * Analyze initial message and generate clarifying questions
   * Returns result indicating if questions were asked or plan was created
   */
  private async analyzeAndAskQuestions(
    conversationId: string,
    initialMessage: Message
  ): Promise<{
    type: "plan" | "questions";
    plan?: string;
    questions?: string[];
  }> {
    const adapter = this.adapterRegistry.getAdapter(this.defaultModel);
    if (!adapter) {
      logger.error(`Session planner adapter ${this.defaultModel} not found`);
      // Fallback: create plan
      const planResult = await this.createPlan(conversationId, initialMessage);
      return { type: "plan", plan: planResult.plan };
    }

    const systemPrompt = PromptLoader.loadPrompt(
      "session-planner-analyze.txt",
      {
        maxQuestions: this.config.sessionPlanner.maxQuestions,
      }
    );

    // Validate message content - if empty, use a default message
    const messageContent =
      initialMessage.content?.trim() || "General discussion";
    const validMessage: Message = {
      ...initialMessage,
      content: messageContent,
    };

    try {
      const messages: Message[] = [validMessage];
      const response = await adapter.generateResponse(messages, systemPrompt);

      const questions = this.parseQuestions(response.content);

      const conversation = this.contextManager.getConversation(conversationId);
      if (conversation && conversation.planningState) {
        conversation.planningState.questions = questions;
      }

      // Post questions if any
      if (questions.length > 0 && this.messageCallback) {
        const questionsText = questions
          .map((q, i) => `${i + 1}. ${q}`)
          .join("\n");
        await this.messageCallback(
          `**Session Planner** 🤔\n\nI'd like to clarify a few things before we start:\n\n${questionsText}\n\nPlease reply with your answers, or use \`/sbb start\` to proceed with defaults. Use \`/sbb edit\` to modify your initial message.`,
          initialMessage.discordMessageId,
          conversationId
        );
        // Return questions state - plan will be created after user responds
        return { type: "questions", questions };
      } else {
        // No questions needed, proceed to plan creation
        const planResult = await this.createPlan(
          conversationId,
          initialMessage
        );
        return { type: "plan", plan: planResult.plan };
      }
    } catch (error) {
      logger.error("Error analyzing message for questions:", error);
      // Fallback: proceed without questions
      const planResult = await this.createPlan(conversationId, initialMessage);
      return { type: "plan", plan: planResult.plan };
    }
  }

  /**
   * Handle user response during planning phase
   * Processes answers to clarifying questions or approval commands
   *
   * @param conversationId - The conversation ID
   * @param message - The user's response message
   */
  async handlePlanningResponse(
    conversationId: string,
    message: Message
  ): Promise<{ type: "plan" | "needs_approval" } | null> {
    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation || conversation.status !== "planning") {
      return null;
    }

    // Add response to planning state
    if (conversation.planningState) {
      // Check if this is an approval command
      if (message.content.toLowerCase().match(/^!?(start|approve|go)$/i)) {
        // If plan exists, approve and start
        if (conversation.planningState.plan) {
          await this.approveAndStart(conversationId);
          return { type: "needs_approval" };
        }
        // If no plan but questions exist, proceed with defaults
        if (conversation.planningState.questions.length > 0) {
          await this.createPlan(conversationId, message);
          return { type: "plan" };
        }
        return null;
      }

      // If we have questions and this is a response, create plan with clarifications
      if (
        conversation.planningState.questions.length > 0 &&
        !conversation.planningState.plan
      ) {
        // User answered questions, now create plan
        await this.createPlan(conversationId, message);
        return { type: "plan" };
      }
    }

    return null;
  }

  /**
   * Create conversation plan with parameters
   * Generates expanded topic, plan, and conversation parameters
   * Returns a promise that resolves when plan is created
   *
   * @param conversationId - The conversation ID
   * @param _contextMessage - Context message for plan generation
   * @returns Promise that resolves with plan data
   */
  private async createPlan(
    conversationId: string,
    _contextMessage: Message
  ): Promise<{
    plan: string;
    expandedTopic: string;
    parameters: {
      maxMessages: number;
      costLimit: number;
      timeoutMinutes: number;
      maxContextWindowPercent: number;
    };
  }> {
    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    // If plan already exists, return it
    if (
      conversation.planningState?.plan &&
      conversation.planningState.parameters
    ) {
      return {
        plan: conversation.planningState.plan,
        expandedTopic:
          conversation.planningState.expandedTopic || conversation.topic,
        parameters: conversation.planningState.parameters,
      };
    }

    const adapter = this.adapterRegistry.getAdapter(this.defaultModel);
    if (!adapter) {
      logger.error(`Session planner adapter ${this.defaultModel} not found`);
      // Fallback: use default plan
      await this.createDefaultPlan(conversationId);
      const conversationAfter =
        this.contextManager.getConversation(conversationId);
      if (
        conversationAfter?.planningState?.plan &&
        conversationAfter.planningState.parameters
      ) {
        return {
          plan: conversationAfter.planningState.plan,
          expandedTopic:
            conversationAfter.planningState.expandedTopic ||
            conversationAfter.topic,
          parameters: conversationAfter.planningState.parameters,
        };
      }
      throw new Error("Failed to create default plan");
    }

    const allMessages = this.contextManager.getMessages(conversationId);

    // Filter out messages with empty content and ensure at least one message exists
    const validMessages = allMessages.filter(
      (msg) => msg.content && msg.content.trim().length > 0
    );

    // If no valid messages, use conversation topic as a default message
    if (validMessages.length === 0) {
      const defaultMessage: Message = {
        id: `default-${Date.now()}`,
        conversationId,
        authorId: "system",
        authorType: "user",
        content: conversation.topic || "General discussion",
        replyTo: [],
        timestamp: new Date(),
      };
      validMessages.push(defaultMessage);
    }

    const systemPrompt = PromptLoader.loadPrompt("session-planner-plan.txt");

    try {
      const response = await adapter.generateResponse(
        validMessages,
        systemPrompt
      );

      // Parse JSON response
      const planData = this.parsePlanResponse(response.content);

      if (conversation.planningState) {
        conversation.planningState.expandedTopic = planData.expandedTopic;
        conversation.planningState.plan = planData.plan;
        conversation.planningState.parameters = planData.parameters;
        conversation.planningState.awaitingApproval = true;
      }

      // Post plan for approval
      if (this.messageCallback) {
        const planText = `**Session Plan** 📋\n\n**Topic:** ${planData.expandedTopic}\n\n**Plan:**\n${planData.plan}\n\n**Parameters:**\n- Max Messages: ${planData.parameters.maxMessages}\n- Cost Limit: $${planData.parameters.costLimit}\n- Timeout: ${planData.parameters.timeoutMinutes} minutes\n- Context Window: ${planData.parameters.maxContextWindowPercent}%\n\nType \`/sbb start\` to begin the conversation, or \`/sbb edit\` to modify the plan.`;
        await this.messageCallback(planText, undefined, conversationId);
      }

      return {
        plan: planData.plan,
        expandedTopic: planData.expandedTopic,
        parameters: planData.parameters,
      };
    } catch (error) {
      logger.error("Error creating plan:", error);
      // Fallback: use default parameters
      await this.createDefaultPlan(conversationId);
      const conversation = this.contextManager.getConversation(conversationId);
      if (
        conversation?.planningState?.plan &&
        conversation.planningState.parameters
      ) {
        return {
          plan: conversation.planningState.plan,
          expandedTopic:
            conversation.planningState.expandedTopic || conversation.topic,
          parameters: conversation.planningState.parameters,
        };
      }
      throw error;
    }
  }

  /**
   * Approve plan and start conversation
   */
  async approveAndStart(conversationId: string): Promise<void> {
    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation || conversation.status !== "planning") {
      return;
    }

    // Clear planning timeout
    this.clearPlanningTimeout(conversationId);

    // Apply parameters if set
    // Note: Per-conversation limits would require extending ContextManager
    // For now, we use config defaults
    if (conversation.planningState?.parameters) {
      // Parameters are stored in planningState for reference
      // Could be used to override config limits per conversation in the future
    }

    // Update topic if expanded
    if (conversation.planningState?.expandedTopic) {
      conversation.topic = conversation.planningState.expandedTopic;
    }

    // Initialize moderation state
    conversation.moderationState = {
      topicDriftCount: 0,
      lastTopicCheck: new Date(),
      originalObjectives: conversation.planningState?.plan
        ? [conversation.planningState.plan]
        : [conversation.topic],
      currentFocus: conversation.topic,
      participantBalance: {},
    };

    // Transition to active
    this.contextManager.updateStatus(conversationId, "active");

    if (this.messageCallback) {
      await this.messageCallback(
        "**Session Started** ✅\n\nThe conversation has begun! All participants can now engage.",
        undefined,
        conversationId
      );
    }

    logger.info(`Conversation ${conversationId} approved and started`);
  }

  /**
   * Monitor an active conversation for topic drift and limits
   * Called for every new message in an active conversation
   *
   * @param conversationId - The conversation ID
   * @param newMessage - The new message to monitor
   */
  async monitorConversation(
    conversationId: string,
    newMessage: Message
  ): Promise<void> {
    const conversation = this.contextManager.getConversation(conversationId);
    if (
      !conversation ||
      conversation.status !== "active" ||
      !conversation.moderationState
    ) {
      return;
    }

    // Update participant balance
    if (this.config.moderator.participantBalanceCheck) {
      const balance = conversation.moderationState.participantBalance;
      const current = balance[newMessage.authorId] || 0;
      balance[newMessage.authorId] = current + 1;
    }

    // Check for topic drift periodically
    const messageCount = conversation.messageCount;
    if (messageCount % this.config.moderator.checkInterval === 0) {
      await this.checkTopicDrift(conversationId, newMessage);
    }

    // Check limits
    const limits = this.contextManager.checkLimits(conversationId);
    if (limits.exceeded) {
      await this.handleLimitExceeded(
        conversationId,
        limits.reason || "Unknown limit"
      );
      return;
    }

    // Assess quality and decide if conversation should end
    if (this.config.moderator.qualityAssessment) {
      await this.assessConversationQuality(conversationId);
    }
  }

  /**
   * Check for topic drift
   */
  private async checkTopicDrift(
    conversationId: string,
    newMessage: Message
  ): Promise<void> {
    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation || !conversation.moderationState) return;

    const adapter = this.adapterRegistry.getAdapter(this.defaultModel);
    if (!adapter) return;

    const systemPrompt = PromptLoader.loadPrompt("session-planner-drift.txt", {
      topic: conversation.topic,
      currentFocus: conversation.moderationState.currentFocus,
    });

    try {
      const recentMessages = conversation.messages.slice(-5);
      const response = await adapter.generateResponse(
        recentMessages,
        systemPrompt
      );

      const driftData = this.parseDriftResponse(response.content);

      if (
        !driftData.onTopic &&
        driftData.driftScore > this.config.moderator.topicDriftThreshold
      ) {
        conversation.moderationState.topicDriftCount++;

        if (
          conversation.moderationState.topicDriftCount <=
          this.config.moderator.maxDriftWarnings
        ) {
          // Steer back on topic
          if (this.messageCallback) {
            const redirectMessage = `**Session Moderator** 🎯\n\n${
              driftData.suggestion || "Let's refocus on the main topic."
            }`;
            await this.messageCallback(
              redirectMessage,
              newMessage.discordMessageId,
              conversationId
            );
          }
        } else {
          // Too much drift, consider stopping
          await this.handleExcessiveDrift(conversationId);
        }
      } else {
        // Reset drift count if back on topic
        conversation.moderationState.topicDriftCount = 0;
      }

      conversation.moderationState.lastTopicCheck = new Date();
    } catch (error) {
      logger.error("Error checking topic drift:", error);
    }
  }

  /**
   * Handle limit exceeded
   */
  private async handleLimitExceeded(
    conversationId: string,
    reason: string
  ): Promise<void> {
    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) return;

    this.contextManager.updateStatus(conversationId, "stopped");

    if (this.messageCallback) {
      await this.messageCallback(
        `**Session Moderator** ⏹️\n\nConversation stopped: ${reason}\n\nThank you for participating!`,
        undefined,
        conversationId
      );
    }

    logger.info(`Conversation ${conversationId} stopped: ${reason}`);
  }

  /**
   * Assess conversation quality
   */
  private async assessConversationQuality(
    conversationId: string
  ): Promise<void> {
    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation || !conversation.moderationState) return;

    // Simple quality assessment based on message count, participant balance, etc.
    const participantCount = Object.keys(
      conversation.moderationState.participantBalance
    ).length;
    const totalMessages = conversation.messageCount;
    const avgMessagesPerParticipant =
      participantCount > 0 ? totalMessages / participantCount : 0;

    // Quality score: 0-1
    let qualityScore = 0.5; // Base score

    // Increase score for more participants
    if (participantCount >= 3) qualityScore += 0.2;

    // Increase score for balanced participation
    if (avgMessagesPerParticipant > 5 && avgMessagesPerParticipant < 20)
      qualityScore += 0.2;

    // Decrease score for excessive drift
    if (
      conversation.moderationState.topicDriftCount >
      this.config.moderator.maxDriftWarnings
    ) {
      qualityScore -= 0.3;
    }

    conversation.moderationState.qualityScore = Math.max(
      0,
      Math.min(1, qualityScore)
    );
  }

  /**
   * Handle excessive topic drift
   */
  private async handleExcessiveDrift(conversationId: string): Promise<void> {
    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) return;

    if (this.messageCallback) {
      await this.messageCallback(
        `**Session Moderator** ⚠️\n\nThe conversation has drifted significantly from the original topic. Consider refocusing or concluding this session.`,
        undefined,
        conversationId
      );
    }
  }

  /**
   * Set planning timeout
   */
  private setPlanningTimeout(conversationId: string): void {
    this.clearPlanningTimeout(conversationId);

    const timeout = setTimeout(() => {
      this.handlePlanningTimeout(conversationId);
    }, this.config.sessionPlanner.timeoutMinutes * 60 * 1000);

    this.planningTimeouts.set(conversationId, timeout);
  }

  /**
   * Clear planning timeout
   */
  private clearPlanningTimeout(conversationId: string): void {
    const timeout = this.planningTimeouts.get(conversationId);
    if (timeout) {
      clearTimeout(timeout);
      this.planningTimeouts.delete(conversationId);
    }
  }

  /**
   * Handle planning timeout
   */
  private handlePlanningTimeout(conversationId: string): void {
    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation || conversation.status !== "planning") return;

    this.contextManager.updateStatus(conversationId, "stopped");

    if (this.messageCallback) {
      this.messageCallback(
        `**Session Planner** ⏱️\n\nPlanning phase timed out. Please start a new conversation.`,
        undefined,
        conversationId
      ).catch((error) => {
        logger.error("Error sending timeout message:", error);
      });
    }

    logger.info(`Planning phase timed out for conversation ${conversationId}`);
  }

  /**
   * Create default plan when AI plan creation fails
   */
  private async createDefaultPlan(conversationId: string): Promise<void> {
    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation || !conversation.planningState) return;

    conversation.planningState.expandedTopic = conversation.topic;
    conversation.planningState.plan = "General discussion on the topic.";
    conversation.planningState.parameters = {
      maxMessages: this.config.limits.maxMessagesPerConversation,
      timeoutMinutes: this.config.limits.conversationTimeoutMinutes,
      maxContextWindowPercent: this.config.limits.maxContextWindowPercent,
      costLimit: this.config.costLimits.conversation,
    };
    conversation.planningState.awaitingApproval = true;

    if (this.messageCallback) {
      await this.messageCallback(
        `**Session Plan** 📋\n\nUsing default parameters. Use \`/sbb start\` to begin, or \`/sbb edit\` to modify the plan.`,
        undefined,
        conversationId
      );
    }
  }

  /**
   * Parse questions from AI response
   */
  private parseQuestions(content: string): string[] {
    if (content.includes("NO_QUESTIONS")) {
      return [];
    }

    const questions: string[] = [];
    const lines = content.split("\n");

    for (const line of lines) {
      const match = line.match(/^\d+\.\s*(.+)$/);
      if (match) {
        questions.push(match[1].trim());
      }
    }

    return questions.slice(0, this.config.sessionPlanner.maxQuestions);
  }

  /**
   * Parse plan response from AI
   */
  private parsePlanResponse(content: string): {
    expandedTopic: string;
    plan: string;
    parameters: {
      maxMessages: number;
      costLimit: number;
      timeoutMinutes: number;
      maxContextWindowPercent: number;
    };
  } {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          expandedTopic: parsed.expandedTopic || "",
          plan: parsed.plan || "",
          parameters: {
            maxMessages:
              parsed.parameters?.maxMessages ||
              this.config.limits.maxMessagesPerConversation,
            costLimit:
              parsed.parameters?.costLimit ||
              this.config.costLimits.conversation,
            timeoutMinutes:
              parsed.parameters?.timeoutMinutes ||
              this.config.limits.conversationTimeoutMinutes,
            maxContextWindowPercent:
              parsed.parameters?.maxContextWindowPercent ||
              this.config.limits.maxContextWindowPercent,
          },
        };
      }
    } catch (error) {
      logger.warn("Failed to parse plan JSON, using defaults");
    }

    // Fallback
    return {
      expandedTopic: "",
      plan: "",
      parameters: {
        maxMessages: this.config.limits.maxMessagesPerConversation,
        costLimit: this.config.costLimits.conversation,
        timeoutMinutes: this.config.limits.conversationTimeoutMinutes,
        maxContextWindowPercent: this.config.limits.maxContextWindowPercent,
      },
    };
  }

  /**
   * Parse drift response from AI
   */
  private parseDriftResponse(content: string): {
    onTopic: boolean;
    driftScore: number;
    suggestion: string;
  } {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          onTopic: parsed.onTopic !== false,
          driftScore: parsed.driftScore || 0,
          suggestion: parsed.suggestion || "",
        };
      }
    } catch (error) {
      logger.warn("Failed to parse drift JSON");
    }

    // Fallback: assume on topic
    return {
      onTopic: true,
      driftScore: 0,
      suggestion: "",
    };
  }
}
