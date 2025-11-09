import {
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
  ThreadChannel,
  SlashCommandBuilder,
  REST,
  Routes,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import type { Config } from "../types/index.js";
import { ConversationCoordinator } from "../services/conversation-coordinator.js";
import { ContextManager } from "../services/context-manager.js";
import { ScribeBot } from "../services/scribe-bot.js";
import { TLDRBot } from "../services/tldr-bot.js";
import { ImageBot } from "../services/image-bot.js";
import { SessionPlanner } from "../services/session-planner.js";
import { logger } from "../utils/logger.js";
import { DiscordRateLimiter } from "../utils/rate-limiter.js";
import { retryWithBackoff } from "../utils/retry.js";
import type { Message as AppMessage } from "../types/index.js";
import {
  getModelPreset,
  detectTaskType,
  isValidModelId,
  type TaskType,
} from "../services/model-selector.js";

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
  public client: Client; // Made public for access in callbacks
  private config: Config;
  private conversationCoordinator: ConversationCoordinator;
  private contextManager: ContextManager;
  private scribeBot: ScribeBot;
  private tldrBot: TLDRBot;
  private imageBot: ImageBot;
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
    imageBot: ImageBot,
    sessionPlanner: SessionPlanner
  ) {
    this.config = config;
    this.conversationCoordinator = conversationCoordinator;
    this.contextManager = contextManager;
    this.scribeBot = scribeBot;
    this.tldrBot = tldrBot;
    this.imageBot = imageBot;
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
   * - clientReady: Bot connection confirmation (renamed from 'ready' in Discord.js v15)
   * - messageCreate: Handle incoming messages
   * - error: Handle Discord client errors
   */
  private setupEventHandlers(): void {
    this.client.once("clientReady", async () => {
      logger.info(`Discord bot logged in as ${this.client.user?.tag}`);
      await this.registerSlashCommands();
    });

    this.client.on("messageCreate", async (message: Message) => {
      // Ignore bot messages (except our own processing)
      if (message.author.bot && message.author.id !== this.client.user?.id) {
        return;
      }

      // Process messages in any channel or thread in the server
      const isInServer = message.guild?.id === this.config.discord.guildId;

      if (!isInServer) {
        return;
      }

      await this.handleMessage(message);
    });

    this.client.on("interactionCreate", async (interaction) => {
      if (interaction.isChatInputCommand()) {
        await this.handleSlashCommand(interaction);
      }
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
      // Get or create conversation
      // Use thread ID if in a thread, otherwise use channel ID
      const channelId = discordMessage.channel.id;
      const thread = discordMessage.channel.isThread()
        ? (discordMessage.channel as ThreadChannel)
        : undefined;

      const conversationId = this.getOrCreateConversation(
        channelId,
        discordMessage.content,
        thread
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
          // If questions were asked, stay in planning mode
          // If plan was created, it will wait for /sbb start
          return;
        } else {
          // Handle planning response - this creates plan if questions were answered
          await this.sessionPlanner.handlePlanningResponse(
            conversationId,
            appMessage
          );
          // If plan was created, it's ready but needs /sbb start to approve
          // Stay in planning mode until user calls /sbb start
          return;
        }
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
   * Handle /sbb start command
   * If no plan exists: creates plan and auto-starts
   * If plan exists: approves and starts (with compilation if in thread)
   */
  private async handleStartCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    await interaction.deferReply();

    try {
      // Get channel - can be TextChannel, ThreadChannel, or null
      const channel = interaction.channel;
      if (!channel) {
        await interaction.editReply({
          content: "Error: No channel found for this interaction.",
        });
        return;
      }

      // Check if channel is a thread (ThreadChannel extends TextChannel)
      const isInThread = channel.isThread();
      let thread: ThreadChannel | undefined = isInThread
        ? (channel as ThreadChannel)
        : undefined;
      const channelId = channel.id;
      const topicOption = interaction.options.getString("topic");

      // Topic is required if not in thread
      if (!isInThread && !topicOption) {
        await interaction.editReply({
          content:
            "Topic is required when not in a thread. Please provide a topic.",
        });
        return;
      }

      const topic =
        topicOption ||
        (thread ? thread.name : undefined) ||
        "General Discussion";

      // If starting in a channel (not a thread), create a thread
      if (!isInThread && channel instanceof TextChannel) {
        await interaction.editReply({
          content: `📝 Creating thread and starting conversation...`,
        });

        try {
          logger.info(`Interaction guild ID: ${interaction.guild?.id}`);
          logger.info(`Bot user ID: ${this.client.user?.id}`);
          // Check if bot has required permissions
          logger.info(`Fetching bot member...`);
          const botMember = await interaction.guild?.members.fetch(
            this.client.user!.id
          );
          const permissions = channel.permissionsFor(botMember!);

          logger.info(
            `Checking permissions for thread creation in channel ${channelId}`
          );

          // Check for Send Messages permission (needed to send starter message)
          const hasSendMessages = permissions?.has("SendMessages");
          logger.info(
            `Send Messages permission: ${
              hasSendMessages ? "✅ Granted" : "❌ Missing"
            }`
          );

          if (!hasSendMessages) {
            throw new Error(
              "Bot does not have permission to send messages in this channel. Please grant 'Send Messages' permission."
            );
          }

          // Check for Create Public Threads permission
          const hasCreateThreads = permissions?.has("CreatePublicThreads");
          logger.info(
            `Create Public Threads permission: ${
              hasCreateThreads ? "✅ Granted" : "❌ Missing"
            }`
          );

          if (!hasCreateThreads) {
            throw new Error(
              "Bot does not have permission to create threads. Please grant 'Create Public Threads' permission."
            );
          }

          logger.info(
            `✅ All required permissions granted. Proceeding with thread creation.`
          );

          // Create thread with topic as name (truncate to 100 chars if needed)
          const threadName =
            topic.length > 50 ? topic.substring(0, 97) + "..." : topic;

          // First, send a message in the channel, then create thread from it
          logger.info(`Sending starter message in channel ${channelId}...`);
          const starterMessage = await channel.send({
            content: topic,
          });
          logger.info(
            `✅ Starter message sent (ID: ${starterMessage.id}). Creating thread...`
          );

          // Create thread from the message
          const newThread = await starterMessage.startThread({
            name: threadName,
            autoArchiveDuration: 1440, // 24 hours
            reason: "Super Brainstorm Bot conversation",
          });
          logger.info(
            `✅ Thread created successfully (ID: ${newThread.id}, Name: ${threadName})`
          );

          // Use the new thread for the conversation
          thread = newThread;

          // Update the interaction reply to point to the thread
          await interaction.editReply({
            content: `✅ Thread created! Starting conversation in <#${newThread.id}>...`,
          });
        } catch (error) {
          logger.error("Error creating thread:", error);
          await interaction.editReply({
            content: `Failed to create thread: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          });
          return;
        }
      }

      const lookupId = thread?.id || channelId;
      if (!lookupId) {
        await interaction.editReply({
          content: "Error: Could not determine channel or thread ID.",
        });
        return;
      }
      const existingConversationId = this.activeConversations.get(lookupId);
      let conversation = existingConversationId
        ? this.contextManager.getConversation(existingConversationId)
        : null;

      // If conversation exists and has a plan, approve and start
      if (
        conversation &&
        conversation.status === "planning" &&
        conversation.planningState?.plan
      ) {
        // Compile previous messages if in thread
        if (isInThread && thread && conversation.messages.length > 1) {
          await interaction.editReply({
            content: `📝 Compiling previous discussion before starting...`,
          });

          try {
            await this.scribeBot.processMessagesImmediate(conversation);
            await this.tldrBot.updateImmediate(conversation);
            await interaction.editReply({
              content: `✅ Previous discussion compiled. Starting conversation...`,
            });
          } catch (error) {
            logger.error("Error compiling previous discussion:", error);
          }
        }

        // Approve and start
        await this.sessionPlanner.approveAndStart(existingConversationId!);
        await interaction.editReply({
          content: `✅ Conversation started! All participants can now engage.`,
        });
        return;
      }

      // If conversation exists but no plan, or no conversation exists
      // Create/get conversation and create plan, then auto-start
      let conversationId: string;
      if (!conversation) {
        // Use thread ID if thread exists, otherwise use channel ID
        const conversationChannelId = thread?.id || channelId;
        if (!conversationChannelId) {
          await interaction.editReply({
            content: "Error: Could not determine channel or thread ID.",
          });
          return;
        }
        conversationId = this.getOrCreateConversation(
          conversationChannelId,
          topic,
          thread
        );
        conversation = this.contextManager.getConversation(conversationId);

        if (!conversation) {
          await interaction.editReply({
            content: "Error: Failed to create conversation.",
          });
          return;
        }

        // If thread was just created, add the first message (topic) to the conversation
        if (thread && !isInThread) {
          // Get the first message from the thread (the topic message we just posted)
          try {
            const messages = await thread.messages.fetch({ limit: 1 });
            const firstThreadMessage = messages.first();
            if (firstThreadMessage) {
              const appMessage: AppMessage = {
                id: firstThreadMessage.id,
                conversationId,
                authorId: firstThreadMessage.author.id,
                authorType: "user",
                content: firstThreadMessage.content,
                replyTo: [],
                timestamp: firstThreadMessage.createdAt,
                discordMessageId: firstThreadMessage.id,
              };
              this.contextManager.addMessage(conversationId, appMessage);
            }
          } catch (error) {
            logger.warn("Failed to fetch first thread message:", error);
          }
        }

        // If in existing thread, fetch and add previous messages
        if (isInThread && thread) {
          const previousMessages = await this.fetchThreadMessages(thread);
          if (previousMessages.length > 0) {
            const appMessages: AppMessage[] = previousMessages.map((msg) => ({
              id: msg.id,
              conversationId,
              authorId: msg.author.id,
              authorType: msg.author.bot ? "ai" : "user",
              content: msg.content,
              replyTo: msg.reference?.messageId
                ? [msg.reference.messageId]
                : [],
              timestamp: msg.createdAt,
              discordMessageId: msg.id,
            }));

            for (const msg of appMessages) {
              this.contextManager.addMessage(conversationId, msg);
            }
          }
        }
      } else {
        conversationId = existingConversationId!;
      }

      // Start planning with first message or topic
      const firstMessage = conversation.messages[0];
      const plannerInputMessage: AppMessage = firstMessage || {
        id: `start-${Date.now()}`,
        conversationId,
        authorId: "system",
        authorType: "user",
        content: topic,
        replyTo: [],
        timestamp: new Date(),
      };

      // Start the planner and await result
      const planningResult = await this.sessionPlanner.handleInitialMessage(
        conversationId,
        plannerInputMessage
      );

      // If questions were asked, short-circuit to planning mode
      if (planningResult.type === "questions") {
        const threadLink = thread ? ` in <#${thread.id}>` : "";
        await interaction.editReply({
          content: `✅ Planning started${threadLink}. Session Planner has asked clarifying questions. Please respond, then use \`/sbb start\` to begin the conversation.`,
        });
        return;
      }

      // Plan was created, auto-start
      if (planningResult.type === "plan") {
        // Compile previous messages if in thread before starting
        if (isInThread && thread && conversation.messages.length > 1) {
          await interaction.editReply({
            content: `📝 Compiling previous discussion before starting...`,
          });

          try {
            await this.scribeBot.processMessagesImmediate(conversation);
            await this.tldrBot.updateImmediate(conversation);
          } catch (error) {
            logger.error("Error compiling previous discussion:", error);
          }
        }

        // Auto-start
        await this.sessionPlanner.approveAndStart(conversationId);
        const threadLink = thread ? ` in <#${thread.id}>` : "";
        await interaction.editReply({
          content: `✅ Conversation started${threadLink}! Plan created and conversation is now active.`,
        });
      }
    } catch (error) {
      logger.error("Error starting conversation:", error);
      await interaction.editReply({
        content: `Failed to start conversation: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    }
  }

  /**
   * Handle /sbb plan command - Explicit planning mode (waits for approval)
   */
  private async handlePlanCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    await interaction.deferReply();

    try {
      const isInThread = interaction.channel?.isThread();
      const thread = isInThread
        ? (interaction.channel as ThreadChannel)
        : undefined;
      const channelId = interaction.channel!.id;
      const topic =
        interaction.options.getString("topic") ||
        (thread ? thread.name : undefined) ||
        "General Discussion";

      // Check if conversation already exists
      const lookupId = thread ? thread.id : channelId;
      const existingConversationId = this.activeConversations.get(lookupId);
      if (existingConversationId) {
        const existingConversation = this.contextManager.getConversation(
          existingConversationId
        );
        if (existingConversation) {
          if (existingConversation.status === "active") {
            await interaction.editReply({
              content:
                "A conversation is already active. Use `/sbb continue` to resume if paused.",
            });
            return;
          } else if (existingConversation.status === "planning") {
            await interaction.editReply({
              content:
                "A conversation is already in planning phase. Use `/sbb start` to approve and start, or `/sbb edit` to modify the plan.",
            });
            return;
          }
        }
      }

      // Get or create conversation (works for both channels and threads)
      const conversationId = this.getOrCreateConversation(
        channelId,
        topic,
        thread
      );
      const conversation = this.contextManager.getConversation(conversationId);

      if (!conversation) {
        await interaction.editReply({
          content: "Error: Failed to create conversation.",
        });
        return;
      }

      // If in thread, fetch and add previous messages (but don't compile yet)
      let previousMessagesCount = 0;
      if (isInThread && thread) {
        const previousMessages = await this.fetchThreadMessages(thread);
        previousMessagesCount = previousMessages.length;

        if (previousMessages.length > 0) {
          // Convert and add messages to conversation (for context)
          const appMessages: AppMessage[] = previousMessages.map((msg) => ({
            id: msg.id,
            conversationId,
            authorId: msg.author.id,
            authorType: msg.author.bot ? "ai" : "user",
            content: msg.content,
            replyTo: msg.reference?.messageId ? [msg.reference.messageId] : [],
            timestamp: msg.createdAt,
            discordMessageId: msg.id,
          }));

          for (const msg of appMessages) {
            this.contextManager.addMessage(conversationId, msg);
          }
        }
      }

      // Start planning immediately with first message or topic
      const firstMessage = conversation.messages[0];
      const plannerInputMessage: AppMessage = firstMessage || {
        id: `plan-${Date.now()}`,
        conversationId,
        authorId: "system",
        authorType: "user",
        content: topic,
        replyTo: [],
        timestamp: new Date(),
      };

      // Start the planner
      await this.sessionPlanner.handleInitialMessage(
        conversationId,
        plannerInputMessage
      );

      // Prepare response message
      const taskType = conversation.taskType || "general";
      const preset = getModelPreset(taskType);
      const costLimit =
        conversation.costLimit || this.config.costLimits.conversation;
      const imageCostLimit =
        conversation.imageCostLimit || this.config.costLimits.image;

      const messageInfo =
        previousMessagesCount > 0
          ? `**Previous Messages:** ${previousMessagesCount} (will be compiled on approval)\n`
          : "";

      const location = isInThread ? "thread" : "channel";
      await interaction.editReply({
        content: `✅ Planning started in ${location}!\n\n**Topic:** ${topic}\n**Task Type:** ${taskType}\n${messageInfo}**Models:** ${preset.conversationModels.length} selected\n**Cost Limits:** Conversation: $${costLimit} | Images: $${imageCostLimit}\n\nSession Planner is analyzing and will create a plan. Use \`/sbb start\` to approve once ready, or \`/sbb edit\` to modify the plan.`,
      });
    } catch (error) {
      logger.error("Error starting planning:", error);
      await interaction.editReply({
        content: `Failed to start planning: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    }
  }

  /**
   * Handle /sbb edit command - Edit planning message
   */
  private async handleEditCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    await interaction.deferReply();

    try {
      const isInThread = interaction.channel?.isThread();
      const thread = isInThread
        ? (interaction.channel as ThreadChannel)
        : undefined;
      const lookupId = thread ? thread.id : interaction.channel!.id;

      const conversationId = this.activeConversations.get(lookupId);
      if (!conversationId) {
        await interaction.editReply({
          content:
            "No active conversation found. Use `/sbb start` to start a new conversation.",
        });
        return;
      }

      const conversation = this.contextManager.getConversation(conversationId);
      if (!conversation) {
        await interaction.editReply({
          content: "Conversation not found.",
        });
        return;
      }

      if (conversation.status !== "planning") {
        await interaction.editReply({
          content: `Conversation is not in planning phase. Current status: ${conversation.status}`,
        });
        return;
      }

      const newMessage = interaction.options.getString("message", true);

      // Create a new message with the edited content
      const editedMessage: AppMessage = {
        id: `edit-${Date.now()}`,
        conversationId,
        authorId: interaction.user.id,
        authorType: "user",
        content: newMessage,
        replyTo: [],
        timestamp: new Date(),
      };

      // Add the edited message to conversation
      this.contextManager.addMessage(conversationId, editedMessage);

      // Re-trigger planning with the edited message
      const planningResponse = await this.sessionPlanner.handlePlanningResponse(
        conversationId,
        editedMessage
      );

      // If plan was created, inform user
      if (planningResponse?.type === "plan") {
        await interaction.editReply({
          content: `✅ Planning message updated. Plan has been created. Use \`/sbb start\` to begin the conversation.`,
        });
      } else {
        await interaction.editReply({
          content: `✅ Planning message updated. Session Planner will update the plan based on your changes.`,
        });
      }
    } catch (error) {
      logger.error("Error editing planning message:", error);
      await interaction.editReply({
        content: `Failed to edit planning message: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    }
  }

  /**
   * Fetch all messages from a Discord thread
   */
  private async fetchThreadMessages(thread: ThreadChannel): Promise<Message[]> {
    const messages: Message[] = [];
    let lastMessageId: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const options: { limit: number; before?: string } = { limit: 100 };
      if (lastMessageId) {
        options.before = lastMessageId;
      }

      const fetched = await thread.messages.fetch(options);
      if (fetched.size === 0) {
        hasMore = false;
        break;
      }

      const sortedMessages = Array.from(fetched.values()).sort(
        (a, b) => a.createdTimestamp - b.createdTimestamp
      );

      messages.push(...sortedMessages);
      lastMessageId = sortedMessages[0]?.id;

      if (fetched.size < 100) {
        hasMore = false;
      }
    }

    return messages;
  }

  /**
   * Get existing conversation for channel or create a new one
   * New conversations start in 'planning' phase
   *
   * @param channelId - Discord channel ID
   * @param topic - Initial topic/message content
   * @returns Conversation ID
   */
  private getOrCreateConversation(
    channelId: string,
    topic: string,
    thread?: ThreadChannel
  ): string {
    // Use thread ID for threads, channel ID for channels
    const lookupId = thread ? thread.id : channelId;
    let conversationId = this.activeConversations.get(lookupId);

    if (!conversationId) {
      conversationId = `conv-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      // Detect task type and get initial models
      const taskType = detectTaskType(topic);
      const preset = getModelPreset(taskType);

      // Use thread ID for thread conversations, channel ID for channel conversations
      const conversationChannelId = thread ? thread.id : channelId;

      this.contextManager.createConversation(
        conversationId,
        conversationChannelId,
        topic,
        [],
        preset.conversationModels,
        taskType
      );

      // Set scribe and tldr models
      const conversation = this.contextManager.getConversation(conversationId);
      if (conversation) {
        conversation.scribeModel = preset.scribeModel;
        conversation.tldrModel = preset.tldrModel;
        conversation.costLimit = this.config.costLimits.conversation;
        conversation.imageCostLimit = this.config.costLimits.image;
        conversation.costTracking = {
          totalCost: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          costsByModel: {},
        };

        // Set thread info if in a thread
        if (thread) {
          conversation.threadId = thread.id;
          conversation.isThread = true;
        }
      }

      // Start in planning phase
      this.contextManager.updateStatus(conversationId, "planning");
      this.activeConversations.set(lookupId, conversationId);
      logger.info(
        `Created new conversation ${conversationId} for ${
          thread ? "thread" : "channel"
        } ${lookupId} (planning phase, task type: ${taskType})`
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
    channel: TextChannel | ThreadChannel,
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
   * Register Discord slash commands
   */
  private async registerSlashCommands(): Promise<void> {
    try {
      const commands = [
        new SlashCommandBuilder()
          .setName("sbb")
          .setDescription("Super Brainstorm Bot commands")
          // Start command (auto-starts if no plan, approves if plan exists)
          .addSubcommand((subcommand) =>
            subcommand
              .setName("start")
              .setDescription(
                "Start conversation: creates plan and auto-starts if no plan exists, or approves existing plan"
              )
              .addStringOption((option) =>
                option
                  .setName("topic")
                  .setDescription(
                    "Topic for the conversation (required if not in thread, optional in threads - uses thread name)"
                  )
                  .setRequired(false)
              )
          )
          // Plan command (explicit planning mode)
          .addSubcommand((subcommand) =>
            subcommand
              .setName("plan")
              .setDescription(
                "Start planning mode: creates a plan and waits for approval"
              )
              .addStringOption((option) =>
                option
                  .setName("topic")
                  .setDescription(
                    "Topic for the conversation (optional in threads - uses thread name)"
                  )
                  .setRequired(false)
              )
          )
          // Settings command
          .addSubcommand((subcommand) =>
            subcommand
              .setName("settings")
              .setDescription("View and modify bot settings")
          )
          // Select models command
          .addSubcommand((subcommand) =>
            subcommand
              .setName("select-models")
              .setDescription("Select AI models for the conversation")
              .addStringOption((option) =>
                option
                  .setName("task-type")
                  .setDescription("Task type to auto-select models")
                  .setRequired(false)
                  .addChoices(
                    { name: "General", value: "general" },
                    { name: "Coding", value: "coding" },
                    { name: "Architecture", value: "architecture" }
                  )
              )
              .addStringOption((option) =>
                option
                  .setName("models")
                  .setDescription(
                    "Comma-separated list of model IDs (e.g., openai/gpt-4o,anthropic/claude-3-5-sonnet)"
                  )
                  .setRequired(false)
              )
              .addStringOption((option) =>
                option
                  .setName("scribe-model")
                  .setDescription(
                    "Model ID for Scribe bot (e.g., openai/gpt-4o)"
                  )
                  .setRequired(false)
              )
              .addStringOption((option) =>
                option
                  .setName("tldr-model")
                  .setDescription(
                    "Model ID for TLDR bot (e.g., anthropic/claude-3-opus-20240229)"
                  )
                  .setRequired(false)
              )
          )
          // Add model command
          .addSubcommand((subcommand) =>
            subcommand
              .setName("add-model")
              .setDescription("Add a model to the current conversation")
              .addStringOption((option) =>
                option
                  .setName("model-id")
                  .setDescription("OpenRouter model ID (e.g., openai/gpt-4o)")
                  .setRequired(true)
              )
          )
          // Remove model command
          .addSubcommand((subcommand) =>
            subcommand
              .setName("remove-model")
              .setDescription("Remove a model from the current conversation")
              .addStringOption((option) =>
                option
                  .setName("model-id")
                  .setDescription("Model ID to remove")
                  .setRequired(true)
              )
          )
          // List models command
          .addSubcommand((subcommand) =>
            subcommand
              .setName("list-models")
              .setDescription("List all models in the current conversation")
          )
          // Fetch models command
          .addSubcommand((subcommand) =>
            subcommand
              .setName("fetch-models")
              .setDescription("Fetch available models from OpenRouter API")
              .addStringOption((option) =>
                option
                  .setName("provider")
                  .setDescription(
                    "Filter by provider (openai, anthropic, x-ai, google)"
                  )
                  .setRequired(false)
              )
          )
          // Go command (approve and start)
          .addSubcommand((subcommand) =>
            subcommand
              .setName("go")
              .setDescription(
                "Approve plan and start conversation (compiles previous discussion if in thread)"
              )
          )
          // Edit command (edit planning)
          .addSubcommand((subcommand) =>
            subcommand
              .setName("edit")
              .setDescription(
                "Edit the planning message while in planning mode"
              )
              .addStringOption((option) =>
                option
                  .setName("message")
                  .setDescription("New planning message or instructions")
                  .setRequired(true)
              )
          )
          // Continue command
          .addSubcommand((subcommand) =>
            subcommand
              .setName("continue")
              .setDescription("Continue a paused conversation")
          )
          // Stop command
          .addSubcommand((subcommand) =>
            subcommand
              .setName("stop")
              .setDescription(
                "Stop a specific agent from responding or stop all agents"
              )
              .addStringOption((option) =>
                option
                  .setName("agent")
                  .setDescription(
                    "Model ID of the agent to stop (e.g., openai/gpt-4o) or 'all' to stop all"
                  )
                  .setRequired(true)
              )
          )
          // Image command
          .addSubcommand((subcommand) =>
            subcommand
              .setName("image")
              .setDescription(
                "Generate images from a message link, prompt, or attachment"
              )
              .addStringOption((option) =>
                option
                  .setName("message-link")
                  .setDescription("Link to a Discord message to use as prompt")
                  .setRequired(false)
              )
              .addStringOption((option) =>
                option
                  .setName("prompt")
                  .setDescription("Text prompt for image generation")
                  .setRequired(false)
              )
              .addAttachmentOption((option) =>
                option
                  .setName("attachment")
                  .setDescription("Image attachment to use as reference")
                  .setRequired(false)
              )
          )
          // Unblock image command
          .addSubcommand((subcommand) =>
            subcommand
              .setName("unblock-image")
              .setDescription(
                "Unblock image generation (if blocked due to cost limit)"
              )
          ),
      ].map((command) => command.toJSON());

      const rest = new REST().setToken(this.config.discord.token);

      await rest.put(
        Routes.applicationGuildCommands(
          this.client.user!.id,
          this.config.discord.guildId
        ),
        { body: commands }
      );

      logger.info("Successfully registered slash commands");
    } catch (error) {
      logger.error("Failed to register slash commands:", error);
    }
  }

  /**
   * Handle slash command interactions
   */
  private async handleSlashCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    // Allow commands in any channel or thread in the server
    const isInServer = interaction.guild?.id === this.config.discord.guildId;

    if (!isInServer) {
      await interaction.reply({
        content: "This command can only be used in the configured server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      if (interaction.commandName !== "sbb") {
        await interaction.reply({
          content: "Unknown command. Use /sbb for all commands.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case "start":
          await this.handleStartCommand(interaction);
          break;
        case "plan":
          await this.handlePlanCommand(interaction);
          break;
        case "edit":
          await this.handleEditCommand(interaction);
          break;
        case "settings":
          await this.handleSettingsCommand(interaction);
          break;
        case "select-models":
          await this.handleSelectModelsCommand(interaction);
          break;
        case "add-model":
          await this.handleAddModelCommand(interaction);
          break;
        case "remove-model":
          await this.handleRemoveModelCommand(interaction);
          break;
        case "list-models":
          await this.handleListModelsCommand(interaction);
          break;
        case "fetch-models":
          await this.handleFetchModelsCommand(interaction);
          break;
        case "continue":
          await this.handleContinueCommand(interaction);
          break;
        case "stop":
          await this.handleStopAgentCommand(interaction);
          break;
        case "image":
          await this.handleImageCommand(interaction);
          break;
        case "unblock-image":
          await this.handleUnblockImageCommand(interaction);
          break;
        default:
          await interaction.reply({
            content: "Unknown subcommand.",
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      logger.error("Error handling slash command:", error);
      await interaction
        .reply({
          content: "An error occurred while processing the command.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
  }

  /**
   * Handle /sbb settings command
   */
  private async handleSettingsCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    await interaction.reply({
      content:
        "Settings command is not yet implemented for interactive modification. Displaying current defaults:\n```json\n" +
        JSON.stringify(this.config.defaultSettings, null, 2) +
        "\n```\n\nTo modify settings, edit `src/config/default-settings.json` and restart the bot.",
      ephemeral: true,
    });
  }

  /**
   * Handle /select-models command
   */
  private async handleSelectModelsCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const taskType = interaction.options.getString(
      "task-type"
    ) as TaskType | null;
    const modelsString = interaction.options.getString("models");
    const scribeModel = interaction.options.getString("scribe-model");
    const tldrModel = interaction.options.getString("tldr-model");

    const conversationId = this.activeConversations.get(
      interaction.channel!.id
    );
    if (!conversationId) {
      await interaction.reply({
        content: "No active conversation found. Start a conversation first.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) {
      await interaction.reply({
        content: "Conversation not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let selectedModels: string[] = [];
    let detectedTaskType: TaskType | undefined;

    if (taskType) {
      // Use preset for task type
      const preset = getModelPreset(taskType);
      selectedModels = [...preset.conversationModels];
      detectedTaskType = taskType;

      // Update conversation with preset models
      conversation.selectedModels = selectedModels;
      conversation.taskType = taskType;
      if (scribeModel) {
        conversation.scribeModel = scribeModel;
      } else {
        conversation.scribeModel = preset.scribeModel;
      }
      if (tldrModel) {
        conversation.tldrModel = tldrModel;
      } else {
        conversation.tldrModel = preset.tldrModel;
      }
    } else if (modelsString) {
      // Parse custom model list
      selectedModels = modelsString
        .split(",")
        .map((m) => m.trim())
        .filter((m) => m.length > 0);

      // Validate model IDs
      const invalidModels = selectedModels.filter((m) => !isValidModelId(m));
      if (invalidModels.length > 0) {
        await interaction.reply({
          content: `Invalid model IDs: ${invalidModels.join(
            ", "
          )}\nModel IDs should be in format "provider/model-id"`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      conversation.selectedModels = selectedModels;
      if (scribeModel) conversation.scribeModel = scribeModel;
      if (tldrModel) conversation.tldrModel = tldrModel;
    } else {
      // Detect task type from conversation messages
      const lastUserMessage = conversation.messages
        .filter((m) => m.authorType === "user")
        .pop();

      if (lastUserMessage) {
        detectedTaskType = detectTaskType(lastUserMessage.content);
        const preset = getModelPreset(detectedTaskType);
        selectedModels = [...preset.conversationModels];
        conversation.selectedModels = selectedModels;
        conversation.taskType = detectedTaskType;
        conversation.scribeModel = preset.scribeModel;
        conversation.tldrModel = preset.tldrModel;
      } else {
        // Use default preset
        const preset = getModelPreset("general");
        selectedModels = [...preset.conversationModels];
        conversation.selectedModels = selectedModels;
        conversation.taskType = "general";
        conversation.scribeModel = preset.scribeModel;
        conversation.tldrModel = preset.tldrModel;
      }
    }

    await interaction.reply({
      content: `✅ Models updated!\n\n**Conversation Models:**\n${selectedModels
        .map((m) => `- ${m}`)
        .join("\n")}\n\n**Scribe Model:** ${
        conversation.scribeModel || "default"
      }\n**TLDR Model:** ${conversation.tldrModel || "default"}\n${
        detectedTaskType ? `**Task Type:** ${detectedTaskType}` : ""
      }`,
      ephemeral: false,
    });
  }

  /**
   * Handle /add-model command
   */
  private async handleAddModelCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const modelId = interaction.options.getString("model-id", true);

    if (!isValidModelId(modelId)) {
      await interaction.reply({
        content: `Invalid model ID: ${modelId}\nModel IDs should be in format "provider/model-id"`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const conversationId = this.activeConversations.get(
      interaction.channel!.id
    );
    if (!conversationId) {
      await interaction.reply({
        content: "No active conversation found. Start a conversation first.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) {
      await interaction.reply({
        content: "Conversation not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (conversation.selectedModels.includes(modelId)) {
      await interaction.reply({
        content: `Model ${modelId} is already in the conversation.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    conversation.selectedModels.push(modelId);

    await interaction.reply({
      content: `✅ Added model: ${modelId}\n\n**Current Models:**\n${conversation.selectedModels
        .map((m) => `- ${m}`)
        .join("\n")}`,
      ephemeral: false,
    });
  }

  /**
   * Handle /remove-model command
   */
  private async handleRemoveModelCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const modelId = interaction.options.getString("model-id", true);

    const conversationId = this.activeConversations.get(
      interaction.channel!.id
    );
    if (!conversationId) {
      await interaction.reply({
        content: "No active conversation found. Start a conversation first.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) {
      await interaction.reply({
        content: "Conversation not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const index = conversation.selectedModels.indexOf(modelId);
    if (index === -1) {
      await interaction.reply({
        content: `Model ${modelId} is not in the conversation.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    conversation.selectedModels.splice(index, 1);

    await interaction.reply({
      content: `✅ Removed model: ${modelId}\n\n**Current Models:**\n${
        conversation.selectedModels.length > 0
          ? conversation.selectedModels.map((m) => `- ${m}`).join("\n")
          : "No models selected"
      }`,
      ephemeral: false,
    });
  }

  /**
   * Handle /list-models command
   */
  private async handleListModelsCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const conversationId = this.activeConversations.get(
      interaction.channel!.id
    );
    if (!conversationId) {
      await interaction.reply({
        content: "No active conversation found. Start a conversation first.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) {
      await interaction.reply({
        content: "Conversation not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modelsList =
      conversation.selectedModels.length > 0
        ? conversation.selectedModels.map((m) => `- ${m}`).join("\n")
        : "No models selected";

    const info = [
      `**Conversation Models:**\n${modelsList}`,
      conversation.taskType ? `**Task Type:** ${conversation.taskType}` : "",
      conversation.scribeModel
        ? `**Scribe Model:** ${conversation.scribeModel}`
        : "",
      conversation.tldrModel ? `**TLDR Model:** ${conversation.tldrModel}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    await interaction.reply({
      content: info || "No model information available.",
      ephemeral: false,
    });
  }

  /**
   * Handle /fetch-models command - Fetch available models from OpenRouter
   */
  private async handleFetchModelsCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const provider = interaction.options.getString("provider");
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: {
          Authorization: `Bearer ${this.config.openrouter.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        data: Array<{ id: string; name: string }>;
      };
      let models = data.data || [];

      if (provider) {
        models = models.filter((m) =>
          m.id.toLowerCase().startsWith(provider.toLowerCase() + "/")
        );
      }

      // Limit to 25 models for display
      const displayModels = models.slice(0, 25);
      const modelsList = displayModels
        .map((m) => `- ${m.id} (${m.name})`)
        .join("\n");
      const moreText =
        models.length > 25
          ? `\n\n... and ${models.length - 25} more models`
          : "";

      await interaction.editReply({
        content: `**Available Models${
          provider ? ` (${provider})` : ""
        }:**\n${modelsList}${moreText}\n\nUse \`/add-model model-id:<model-id>\` to add a model to the conversation.`,
      });
    } catch (error) {
      logger.error("Error fetching models:", error);
      await interaction.editReply({
        content: `Failed to fetch models: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    }
  }

  /**
   * Handle /continue command - Continue paused conversation
   */
  private async handleContinueCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const channelId = interaction.channel?.id;
    if (!channelId) {
      await interaction.reply({
        content: "Invalid channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const conversationId = this.activeConversations.get(channelId);
    if (!conversationId) {
      await interaction.reply({
        content: "No active conversation found. Start a conversation first.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) {
      await interaction.reply({
        content: "Conversation not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (conversation.status !== "paused") {
      await interaction.reply({
        content: `Conversation is not paused. Current status: ${conversation.status}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check cost limit
    const currentCost = conversation.costTracking?.totalCost || 0;
    const costLimit =
      conversation.costLimit || this.config.costLimits.conversation;
    if (currentCost >= costLimit) {
      await interaction.reply({
        content: `⚠️ Cost limit reached ($${currentCost.toFixed(
          2
        )} / $${costLimit}). Please increase the limit or start a new conversation.`,
        ephemeral: false,
      });
      return;
    }

    this.contextManager.updateStatus(conversationId, "active");

    await interaction.reply({
      content: `✅ Conversation resumed!\n\n**Current Cost:** $${currentCost.toFixed(
        2
      )} / $${costLimit}\n**Status:** Active\n**Models:** ${
        conversation.selectedModels.length
      } active`,
      ephemeral: false,
    });
  }

  /**
   * Handle /stop command - Stop a specific agent or all agents
   */
  private async handleStopAgentCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const agentModelId = interaction.options.getString("agent", true);
    const channelId = interaction.channel?.id;

    if (!channelId) {
      await interaction.reply({
        content: "Invalid channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const conversationId = this.activeConversations.get(channelId);
    if (!conversationId) {
      await interaction.reply({
        content: "No active conversation found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) {
      await interaction.reply({
        content: "Conversation not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Handle "all" command
    if (agentModelId.toLowerCase() === "all") {
      // Initialize activeAgents if not set (use selectedModels as fallback)
      const activeAgents =
        conversation.activeAgents || conversation.selectedModels || [];

      // Cannot disable manager, scribe, tldr, or image bot
      const protectedAgents = [
        conversation.scribeModel,
        conversation.tldrModel,
        "manager", // Session planner/manager
        ...(conversation.imageModels || []), // Image generation models
      ].filter(Boolean);

      // Disable all non-protected active agents
      if (!conversation.disabledAgents) {
        conversation.disabledAgents = [];
      }

      const agentsToDisable = activeAgents.filter(
        (agent) =>
          !protectedAgents.some((protectedAgent) =>
            agent.includes(protectedAgent || "")
          )
      );

      conversation.disabledAgents.push(...agentsToDisable);
      conversation.disabledAgents = [...new Set(conversation.disabledAgents)]; // Remove duplicates

      await interaction.reply({
        content: `✅ All agents stopped!\n\n**Disabled Agents:**\n${conversation.disabledAgents
          .map((a) => `- ${a}`)
          .join(
            "\n"
          )}\n\n**Protected Agents (cannot be stopped):**\n${protectedAgents
          .map((a) => `- ${a}`)
          .join("\n")}`,
        ephemeral: false,
      });
      return;
    }

    // Cannot disable manager, scribe, tldr, or image bot
    const protectedAgents = [
      conversation.scribeModel,
      conversation.tldrModel,
      "manager", // Session planner/manager
      ...(conversation.imageModels || []), // Image generation models
    ].filter(Boolean);

    if (protectedAgents.some((agent) => agentModelId.includes(agent || ""))) {
      await interaction.reply({
        content:
          "Cannot disable manager, scribe, tldr, or image agents. These are required for conversation management.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check if agent is in active agents (agents that were actually launched)
    const activeAgents =
      conversation.activeAgents || conversation.selectedModels || [];
    if (!activeAgents.includes(agentModelId)) {
      await interaction.reply({
        content: `Agent ${agentModelId} is not active in the conversation. Active agents: ${
          activeAgents.join(", ") || "none"
        }`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Add to disabled agents
    if (!conversation.disabledAgents) {
      conversation.disabledAgents = [];
    }

    if (conversation.disabledAgents.includes(agentModelId)) {
      await interaction.reply({
        content: `Agent ${agentModelId} is already disabled.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    conversation.disabledAgents.push(agentModelId);

    await interaction.reply({
      content: `✅ Agent ${agentModelId} has been stopped.\n\n**Disabled Agents:**\n${conversation.disabledAgents
        .map((a) => `- ${a}`)
        .join("\n")}\n\n**Active Agents:**\n${activeAgents
        .filter((m) => !conversation.disabledAgents?.includes(m))
        .map((m) => `- ${m}`)
        .join("\n")}`,
      ephemeral: false,
    });
  }

  /**
   * Handle /image command - Generate images from message or prompt
   */
  private async handleImageCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    await interaction.deferReply();

    try {
      const messageLink = interaction.options.getString("message-link");
      const prompt = interaction.options.getString("prompt");
      const attachment = interaction.options.getAttachment("attachment");
      const channelId = interaction.channel?.id;

      if (!channelId) {
        await interaction.editReply({
          content: "Invalid channel.",
        });
        return;
      }

      // Check if image generation is blocked
      const conversationId = this.activeConversations.get(channelId);
      if (conversationId) {
        const conversation =
          this.contextManager.getConversation(conversationId);
        if (conversation) {
          if (conversation.imageGenerationBlocked) {
            const imageCostLimit =
              conversation.imageCostLimit || this.config.costLimits.image;
            const currentImageCost =
              conversation.imageCostTracking?.totalCost || 0;
            await interaction.editReply({
              content: `🚫 Image generation is blocked due to cost limit.\n\n**Current Cost:** $${currentImageCost.toFixed(
                2
              )} / $${imageCostLimit}\n\nUse \`/sbb unblock-image\` to unblock image generation.`,
            });
            return;
          }

          // Check if we're about to exceed the limit
          const imageCostLimit =
            conversation.imageCostLimit || this.config.costLimits.image;
          const currentImageCost =
            conversation.imageCostTracking?.totalCost || 0;
          if (currentImageCost >= imageCostLimit) {
            conversation.imageGenerationBlocked = true;
            await interaction.editReply({
              content: `🚫 Image generation is blocked due to cost limit.\n\n**Current Cost:** $${currentImageCost.toFixed(
                2
              )} / $${imageCostLimit}\n\nUse \`/sbb unblock-image\` to unblock image generation.`,
            });
            return;
          }
        }
      }

      let imagePrompt = prompt || "";

      // If message link provided, fetch the message
      if (messageLink) {
        try {
          // Parse Discord message link format: https://discord.com/channels/GUILD_ID/CHANNEL_ID/MESSAGE_ID
          const linkMatch = messageLink.match(
            /discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/
          );
          if (linkMatch) {
            const [, , channelIdFromLink, messageId] = linkMatch;
            const channel = this.client.channels.cache.get(channelIdFromLink);
            if (channel && "messages" in channel) {
              const message = await channel.messages.fetch(messageId);
              if (message) {
                // Use message content or TLDR if available
                if (message.content) {
                  imagePrompt = this.imageBot.extractPromptFromContent(
                    message.content
                  );
                } else if (message.embeds.length > 0) {
                  // Extract from embed if available
                  const embedContent = message.embeds
                    .map((e) => e.description || e.title || "")
                    .join(" ");
                  if (embedContent) {
                    imagePrompt =
                      this.imageBot.extractPromptFromContent(embedContent);
                  }
                }
              }
            }
          }
        } catch (error) {
          logger.error("Error fetching message from link:", error);
          await interaction.editReply({
            content:
              "Failed to fetch message from link. Please provide a prompt instead.",
          });
          return;
        }
      }

      // If attachment provided, use it as reference
      if (attachment && attachment.contentType?.startsWith("image/")) {
        // For image input, we'd need to use vision models to describe the image
        // For now, we'll use the image URL as part of the prompt
        imagePrompt = `${imagePrompt || "Generate an image based on this"}: ${
          attachment.url
        }`;
      }

      if (!imagePrompt) {
        await interaction.editReply({
          content:
            "Please provide either a message link, prompt, or image attachment.",
        });
        return;
      }

      // Get or create conversation to track image models
      // Reuse conversationId from earlier check if available
      let conversation = conversationId
        ? this.contextManager.getConversation(conversationId)
        : null;

      if (!conversation) {
        // Create a temporary conversation for image generation
        const tempId = `img-${Date.now()}-${Math.random()
          .toString(36)
          .substr(2, 9)}`;
        this.contextManager.createConversation(
          tempId,
          channelId,
          "Image Generation",
          [],
          [],
          "general"
        );
        conversation = this.contextManager.getConversation(tempId);
      }

      if (conversation) {
        // Initialize image models if not set
        if (!conversation.imageModels) {
          conversation.imageModels = [
            "openai/gpt-5-image",
            "google/gemini-2.5-flash-image",
          ];
        }
        // Track image models as active agents
        if (!conversation.activeAgents) {
          conversation.activeAgents = [];
        }
        conversation.imageModels.forEach((model) => {
          if (!conversation!.activeAgents!.includes(model)) {
            conversation!.activeAgents!.push(model);
          }
        });
      }

      // Generate images
      const imageModels = conversation?.imageModels || [
        "openai/gpt-5-image",
        "google/gemini-2.5-flash-image",
      ];

      await interaction.editReply({
        content: `🎨 Generating images with prompt: "${imagePrompt}"...`,
      });

      const results = await this.imageBot.generateImages(
        imagePrompt,
        imageModels
      );

      // Update image cost tracking
      if (conversation) {
        if (!conversation.imageCostTracking) {
          conversation.imageCostTracking = {
            totalCost: 0,
            totalImages: 0,
            costsByModel: {},
          };
        }

        results.forEach((result) => {
          if (result.imageUrl && result.cost) {
            conversation.imageCostTracking!.totalCost += result.cost;
            conversation.imageCostTracking!.totalImages += 1;

            if (!conversation.imageCostTracking!.costsByModel[result.modelId]) {
              conversation.imageCostTracking!.costsByModel[result.modelId] = {
                cost: 0,
                imageCount: 0,
                requestCount: 0,
              };
            }

            conversation.imageCostTracking!.costsByModel[result.modelId].cost +=
              result.cost;
            conversation.imageCostTracking!.costsByModel[
              result.modelId
            ].imageCount += 1;
            conversation.imageCostTracking!.costsByModel[
              result.modelId
            ].requestCount += 1;
          }
        });

        // Check if we've exceeded image cost limit
        const imageCostLimit =
          conversation.imageCostLimit || this.config.costLimits.image;
        if (conversation.imageCostTracking.totalCost >= imageCostLimit) {
          conversation.imageGenerationBlocked = true;
          logger.warn(
            `Image cost limit reached: $${conversation.imageCostTracking.totalCost.toFixed(
              2
            )} / $${imageCostLimit}. Image generation blocked.`
          );
        }
      }

      // Format response with image URLs
      const successResults = results.filter((r) => r.imageUrl);
      const errorResults = results.filter((r) => r.error);

      if (successResults.length === 0) {
        await interaction.editReply({
          content: `❌ Failed to generate images.\n\n**Errors:**\n${errorResults
            .map((r) => `- ${r.modelId}: ${r.error}`)
            .join("\n")}`,
        });
        return;
      }

      // Send images as embeds
      const totalImageCost = successResults.reduce(
        (sum, r) => sum + (r.cost || 0),
        0
      );
      const imageCostLimit =
        conversation?.imageCostLimit || this.config.costLimits.image;
      const currentImageCost = conversation?.imageCostTracking?.totalCost || 0;

      const imageEmbeds = successResults.map((result, index) => ({
        title: `Image ${index + 1} (${result.modelId})`,
        image: { url: result.imageUrl },
        footer: {
          text: `${result.modelId} - Cost: $${(result.cost || 0).toFixed(4)}`,
        },
      }));

      const costInfo = conversation
        ? `\n💰 **Image Cost:** $${totalImageCost.toFixed(
            2
          )} (Total: $${currentImageCost.toFixed(2)} / $${imageCostLimit})`
        : `\n💰 **Image Cost:** $${totalImageCost.toFixed(2)}`;

      await interaction.editReply({
        content: `✅ Generated ${successResults.length} image(s):${costInfo}`,
        embeds: imageEmbeds.slice(0, 10), // Discord limit: 10 embeds
      });

      // If more than 10 images, send additional messages
      if (successResults.length > 10) {
        for (let i = 10; i < successResults.length; i += 10) {
          await interaction.followUp({
            embeds: imageEmbeds.slice(i, i + 10),
          });
        }
      }
    } catch (error) {
      logger.error("Error generating images:", error);
      await interaction.editReply({
        content: `Failed to generate images: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    }
  }

  /**
   * Handle /sbb unblock-image command - Unblock image generation
   */
  private async handleUnblockImageCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    await interaction.deferReply();

    try {
      const channelId = interaction.channel?.id;
      if (!channelId) {
        await interaction.editReply({
          content: "Invalid channel.",
        });
        return;
      }

      const conversationId = this.activeConversations.get(channelId);
      if (!conversationId) {
        await interaction.editReply({
          content: "No active conversation found in this channel/thread.",
        });
        return;
      }

      const conversation = this.contextManager.getConversation(conversationId);
      if (!conversation) {
        await interaction.editReply({
          content: "Conversation not found.",
        });
        return;
      }

      if (!conversation.imageGenerationBlocked) {
        await interaction.editReply({
          content: "✅ Image generation is not blocked.",
        });
        return;
      }

      // Unblock image generation
      conversation.imageGenerationBlocked = false;
      const imageCostLimit =
        conversation.imageCostLimit || this.config.costLimits.image;
      const currentImageCost = conversation.imageCostTracking?.totalCost || 0;

      await interaction.editReply({
        content: `✅ Image generation has been unblocked.\n\n**Current Cost:** $${currentImageCost.toFixed(
          2
        )} / $${imageCostLimit}\n\nYou can now generate images again.`,
      });
    } catch (error) {
      logger.error("Error unblocking image generation:", error);
      await interaction.editReply({
        content: `Failed to unblock image generation: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    }
  }

  /**
   * Get the configured Discord text channel (deprecated - bot works in any channel/thread)
   *
   * @returns null (deprecated method)
   */
  getChannel(): TextChannel | null {
    // Deprecated: Bot now works in any channel/thread in the server
    return null;
  }
}
