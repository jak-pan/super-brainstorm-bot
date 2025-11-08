import { Client, GatewayIntentBits, Message, TextChannel } from "discord.js";
import type { Config } from "../types/index.js";
import { ConversationCoordinator } from "../services/conversation-coordinator.js";
import { ContextManager } from "../services/context-manager.js";
import { ScribeBot } from "../services/scribe-bot.js";
import { TLDRBot } from "../services/tldr-bot.js";
import { SessionPlanner } from "../services/session-planner.js";
import { logger } from "../utils/logger.js";
import { DiscordRateLimiter } from "../utils/rate-limiter.js";
import { retryWithBackoff } from "../utils/retry.js";
import type { Message as AppMessage } from "../types/index.js";

/**
 * Discord Bot Core - Main entry point for all Discord interactions
 *
 * Handles:
 * - Message listening and routing
 * - Command processing
 * - AI response posting
 * - Conversation state management
 * - Rate limiting
 */
export class DiscordBot {
  private client: Client;
  private config: Config;
  private conversationCoordinator: ConversationCoordinator;
  private contextManager: ContextManager;
  private scribeBot: ScribeBot;
  private tldrBot: TLDRBot;
  private sessionPlanner: SessionPlanner;
  private activeConversations: Map<string, string> = new Map(); // channelId -> conversationId
  private rateLimiter: DiscordRateLimiter;

  /**
   * Create a new Discord bot instance
   *
   * @param config - Application configuration
   * @param conversationCoordinator - Coordinator for multi-AI conversations
   * @param contextManager - Manager for conversation context
   * @param scribeBot - Bot for documenting conversations
   * @param tldrBot - Bot for generating summaries
   * @param sessionPlanner - Planner and moderator for sessions
   */
  constructor(
    config: Config,
    conversationCoordinator: ConversationCoordinator,
    contextManager: ContextManager,
    scribeBot: ScribeBot,
    tldrBot: TLDRBot,
    sessionPlanner: SessionPlanner
  ) {
    this.config = config;
    this.conversationCoordinator = conversationCoordinator;
    this.contextManager = contextManager;
    this.scribeBot = scribeBot;
    this.tldrBot = tldrBot;
    this.sessionPlanner = sessionPlanner;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.rateLimiter = new DiscordRateLimiter();
    this.setupEventHandlers();
  }

  /**
   * Set up Discord event handlers
   * - ready: Bot connection confirmation
   * - messageCreate: Handle incoming messages
   * - error: Handle Discord client errors
   */
  private setupEventHandlers(): void {
    this.client.once("ready", () => {
      logger.info(`Discord bot logged in as ${this.client.user?.tag}`);
    });

    this.client.on("messageCreate", async (message: Message) => {
      // Ignore bot messages (except our own processing)
      if (message.author.bot && message.author.id !== this.client.user?.id) {
        return;
      }

      // Only process messages in the configured channel
      if (message.channel.id !== this.config.discord.channelId) {
        return;
      }

      await this.handleMessage(message);
    });

    this.client.on("error", (error) => {
      logger.error("Discord client error:", error);
    });
  }

  /**
   * Handle incoming Discord messages
   * Routes to command handler or conversation flow based on message content
   *
   * @param discordMessage - The Discord message to handle
   */
  private async handleMessage(discordMessage: Message): Promise<void> {
    try {
      // Check for commands
      if (discordMessage.content.startsWith("!")) {
        await this.handleCommand(discordMessage);
        return;
      }

      // Get or create conversation
      const conversationId = this.getOrCreateConversation(
        discordMessage.channel.id,
        discordMessage.content
      );
      const conversation = this.contextManager.getConversation(conversationId);

      // Convert Discord message to app message
      const appMessage: AppMessage = {
        id: discordMessage.id,
        conversationId,
        authorId: discordMessage.author.id,
        authorType: "user",
        content: discordMessage.content,
        replyTo: discordMessage.reference?.messageId
          ? [discordMessage.reference.messageId]
          : [],
        timestamp: discordMessage.createdAt,
        discordMessageId: discordMessage.id,
      };

      // Handle planning phase
      if (conversation && conversation.status === "planning") {
        // Add message to context first
        this.contextManager.addMessage(conversationId, appMessage);

        // If this is the first message, start planning
        if (conversation.messages.length === 1) {
          await this.sessionPlanner.handleInitialMessage(
            conversationId,
            appMessage
          );
        } else {
          // Handle planning response
          await this.sessionPlanner.handlePlanningResponse(
            conversationId,
            appMessage
          );
        }
        return;
      }

      // Handle active conversation
      if (conversation && conversation.status === "active") {
        // Add message to context first
        this.contextManager.addMessage(conversationId, appMessage);

        // Notify session planner for moderation (async)
        this.sessionPlanner
          .monitorConversation(conversationId, appMessage)
          .catch((error) => {
            logger.error("Session planner moderation error:", error);
          });

        // Handle the message in coordinator
        await this.conversationCoordinator.handleNewMessage(
          conversationId,
          appMessage
        );

        // Trigger scribe update (async, non-blocking)
        this.scribeBot.notifyNewMessages(conversation).catch((error) => {
          logger.error("Scribe bot error:", error);
        });

        // Check and update TLDR (async, non-blocking)
        this.tldrBot.checkAndUpdate(conversation).catch((error) => {
          logger.error("TLDR bot error:", error);
        });
      }

      // AI responses will be posted automatically via the coordinator's callback
    } catch (error) {
      logger.error("Error handling message:", error);
    }
  }

  /**
   * Handle Discord commands (messages starting with !)
   *
   * Supported commands:
   * - !start / !approve: Approve plan and start conversation
   * - !continue: Resume paused conversation
   * - !stop: Stop conversation
   * - !pause: Pause conversation
   * - !status: Show conversation status
   * - !refresh: Force context refresh
   * - !focus: Show current conversation focus
   * - !summary: Show conversation summary
   *
   * @param message - The Discord message containing the command
   */
  private async handleCommand(message: Message): Promise<void> {
    const [command] = message.content.slice(1).split(" ");

    switch (command.toLowerCase()) {
      case "start":
      case "approve":
        await this.handleStartCommand(message);
        break;
      case "continue":
        await this.handleContinueCommand(message);
        break;
      case "stop":
        await this.handleStopCommand(message);
        break;
      case "pause":
        await this.handlePauseCommand(message);
        break;
      case "status":
        await this.handleStatusCommand(message);
        break;
      case "refresh":
        await this.handleRefreshCommand(message);
        break;
      case "focus":
        await this.handleFocusCommand(message);
        break;
      case "summary":
        await this.handleSummaryCommand(message);
        break;
      default:
        await message.reply(
          `Unknown command: ${command}. Available commands: !start, !approve, !continue, !stop, !pause, !status, !refresh, !focus, !summary`
        );
    }
  }

  private async handleStartCommand(message: Message): Promise<void> {
    const conversationId = this.activeConversations.get(message.channel.id);
    if (!conversationId) {
      await message.reply("No active conversation found.");
      return;
    }

    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) {
      await message.reply("Conversation not found.");
      return;
    }

    if (conversation.status === "planning") {
      await this.sessionPlanner.approveAndStart(conversationId);
    } else {
      await message.reply("Conversation is not in planning phase.");
    }
  }

  private async handleFocusCommand(message: Message): Promise<void> {
    const conversationId = this.activeConversations.get(message.channel.id);
    if (!conversationId) {
      await message.reply("No active conversation found.");
      return;
    }

    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation || !conversation.moderationState) {
      await message.reply("Conversation not found or not active.");
      return;
    }

    const focus =
      conversation.moderationState.currentFocus || conversation.topic;
    await message.reply(`**Current Focus:** ${focus}`);
  }

  private async handleSummaryCommand(message: Message): Promise<void> {
    const conversationId = this.activeConversations.get(message.channel.id);
    if (!conversationId) {
      await message.reply("No active conversation found.");
      return;
    }

    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) {
      await message.reply("Conversation not found.");
      return;
    }

    const summary = `**Conversation Summary**
Topic: ${conversation.topic}
Status: ${conversation.status}
Messages: ${conversation.messageCount}
Tokens: ${conversation.tokenCount}
Context Usage: ${(
      (conversation.contextWindow.current / conversation.contextWindow.max) *
      100
    ).toFixed(1)}%
${
  conversation.moderationState?.qualityScore
    ? `Quality Score: ${(
        conversation.moderationState.qualityScore * 100
      ).toFixed(0)}%`
    : ""
}`;

    await message.reply(summary);
  }

  private async handleContinueCommand(message: Message): Promise<void> {
    const conversationId = this.activeConversations.get(message.channel.id);
    if (!conversationId) {
      await message.reply("No active conversation found.");
      return;
    }

    this.contextManager.updateStatus(conversationId, "active");
    await message.reply("Conversation resumed.");
  }

  private async handleStopCommand(message: Message): Promise<void> {
    const conversationId = this.activeConversations.get(message.channel.id);
    if (!conversationId) {
      await message.reply("No active conversation found.");
      return;
    }

    this.contextManager.updateStatus(conversationId, "stopped");
    await message.reply("Conversation stopped.");
  }

  private async handlePauseCommand(message: Message): Promise<void> {
    const conversationId = this.activeConversations.get(message.channel.id);
    if (!conversationId) {
      await message.reply("No active conversation found.");
      return;
    }

    this.contextManager.updateStatus(conversationId, "paused");
    await message.reply("Conversation paused.");
  }

  private async handleStatusCommand(message: Message): Promise<void> {
    const conversationId = this.activeConversations.get(message.channel.id);
    if (!conversationId) {
      await message.reply("No active conversation found.");
      return;
    }

    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) {
      await message.reply("Conversation not found.");
      return;
    }

    const status = `**Conversation Status**
Topic: ${conversation.topic}
Status: ${conversation.status}
Messages: ${conversation.messageCount}
Tokens: ${conversation.tokenCount}
Context Usage: ${(
      (conversation.contextWindow.current / conversation.contextWindow.max) *
      100
    ).toFixed(1)}%`;

    await message.reply(status);
  }

  private async handleRefreshCommand(message: Message): Promise<void> {
    const conversationId = this.activeConversations.get(message.channel.id);
    if (!conversationId) {
      await message.reply("No active conversation found.");
      return;
    }

    await this.contextManager.refreshContext(conversationId);
    await message.reply("Context refreshed from Notion.");
  }

  /**
   * Get existing conversation for channel or create a new one
   * New conversations start in 'planning' phase
   *
   * @param channelId - Discord channel ID
   * @param topic - Initial topic/message content
   * @returns Conversation ID
   */
  private getOrCreateConversation(channelId: string, topic: string): string {
    let conversationId = this.activeConversations.get(channelId);

    if (!conversationId) {
      conversationId = `conv-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      this.contextManager.createConversation(
        conversationId,
        channelId,
        topic,
        []
      );
      // Start in planning phase
      this.contextManager.updateStatus(conversationId, "planning");
      this.activeConversations.set(channelId, conversationId);
      logger.info(
        `Created new conversation ${conversationId} for channel ${channelId} (planning phase)`
      );
    }

    return conversationId;
  }

  /**
   * Post an AI response to Discord with rate limiting and retry logic
   *
   * @param channel - Discord text channel to post to
   * @param response - AI response with content, replyTo, and model
   * @returns The sent Discord message, or null if failed
   */
  async postAIResponse(
    channel: TextChannel,
    response: { content: string; replyTo: string[]; model: string }
  ): Promise<Message | null> {
    return retryWithBackoff(
      async () => {
        // Wait for rate limit if needed
        await this.rateLimiter.waitAndRecord();

        let replyToMessage: Message | null = null;

        if (response.replyTo.length > 0) {
          // Get the first message to reply to (Discord only supports one reference)
          const replyToId = response.replyTo[0];
          replyToMessage = await channel.messages
            .fetch(replyToId)
            .catch(() => null);
        }

        const content = `**[${response.model}]**\n\n${response.content}`;

        const sentMessage = await channel.send({
          content,
          reply: replyToMessage
            ? { messageReference: replyToMessage }
            : undefined,
        });

        return sentMessage;
      },
      {
        maxRetries: 3,
        initialDelay: 1000,
        retryableErrors: [
          "rate_limit",
          "timeout",
          "network",
          "ECONNRESET",
          "ETIMEDOUT",
        ],
      }
    ).catch((error) => {
      logger.error("Error posting AI response:", error);
      return null;
    });
  }

  /**
   * Start the Discord bot and connect to Discord
   *
   * @throws Error if login fails
   */
  async start(): Promise<void> {
    try {
      await this.client.login(this.config.discord.token);
      logger.info("Discord bot started successfully");
    } catch (error) {
      logger.error("Failed to start Discord bot:", error);
      throw error;
    }
  }

  /**
   * Stop the Discord bot and disconnect
   */
  async stop(): Promise<void> {
    this.client.destroy();
    logger.info("Discord bot stopped");
  }

  /**
   * Get the configured Discord text channel
   *
   * @returns The text channel, or null if not found or not a text channel
   */
  getChannel(): TextChannel | null {
    const channel = this.client.channels.cache.get(
      this.config.discord.channelId
    );
    return channel instanceof TextChannel ? channel : null;
  }
}
