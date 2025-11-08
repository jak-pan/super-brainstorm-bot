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
   * - ready: Bot connection confirmation
   * - messageCreate: Handle incoming messages
   * - error: Handle Discord client errors
   */
  private setupEventHandlers(): void {
    this.client.once("ready", async () => {
      logger.info(`Discord bot logged in as ${this.client.user?.tag}`);
      await this.registerSlashCommands();
    });

    this.client.on("messageCreate", async (message: Message) => {
      // Ignore bot messages (except our own processing)
      if (message.author.bot && message.author.id !== this.client.user?.id) {
        return;
      }

      // Process messages in configured channel OR any thread in the server
      const isInConfiguredChannel =
        message.channel.id === this.config.discord.channelId;
      const isInThread = message.channel.isThread();
      const isInServerThread =
        isInThread && message.guild?.id === this.config.discord.guildId;

      if (!isInConfiguredChannel && !isInServerThread) {
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
   * Handle /sbb start slash command
   * Works in both channels and threads - automatically detects context
   */
  private async handleStartCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: false });

    try {
      const isInThread = interaction.channel?.isThread();

      if (isInThread) {
        // Handle thread context - compile previous discussion
        await this.handleStartInThread(interaction);
      } else {
        // Handle channel context - simple start
        await this.handleStartInChannel(interaction);
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
   * Handle start command in a channel (simple start)
   */
  private async handleStartInChannel(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const topic =
      interaction.options.getString("topic") || "General Discussion";
    const channelId = interaction.channel!.id;

    const conversationId = this.getOrCreateConversation(channelId, topic);
    const conversation = this.contextManager.getConversation(conversationId);

    if (conversation?.status === "planning") {
      await this.sessionPlanner.approveAndStart(conversationId);
      await interaction.editReply(
        `✅ Conversation started with topic: "${topic}"`
      );
    } else {
      await interaction.editReply(
        "Conversation is not in planning phase or already active."
      );
    }
  }

  /**
   * Handle start command in a thread (compiles previous discussion)
   */
  private async handleStartInThread(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const thread = interaction.channel as ThreadChannel;
    const topic =
      interaction.options.getString("topic") ||
      thread.name ||
      "Thread Discussion";

    // Check if conversation already exists
    const existingConversationId = this.activeConversations.get(thread.id);
    if (existingConversationId) {
      await interaction.editReply({
        content:
          "A conversation is already active in this thread. Use `/sbb continue` to resume if paused.",
      });
      return;
    }

    // Fetch previous messages from thread
    const previousMessages: Message[] = [];
    let lastMessageId: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const options: { limit: number; before?: string } = { limit: 100 };
      if (lastMessageId) {
        options.before = lastMessageId;
      }

      const messages = await thread.messages.fetch(options);
      if (messages.size === 0) {
        hasMore = false;
        break;
      }

      const sortedMessages = Array.from(messages.values()).sort(
        (a, b) => a.createdTimestamp - b.createdTimestamp
      );

      previousMessages.push(...sortedMessages);
      lastMessageId = sortedMessages[0]?.id;

      if (messages.size < 100) {
        hasMore = false;
      }
    }

    // Create conversation
    const conversationId = `conv-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Detect task type and get initial models
    const taskType = detectTaskType(topic);
    const preset = getModelPreset(taskType);

    this.contextManager.createConversation(
      conversationId,
      thread.id,
      topic,
      [],
      preset.conversationModels,
      taskType
    );

    const conversation = this.contextManager.getConversation(conversationId);
    if (conversation) {
      conversation.threadId = thread.id;
      conversation.isThread = true;
      conversation.costLimit = this.config.costLimits.conversation;
      conversation.imageCostLimit = this.config.costLimits.image;
      conversation.scribeModel = preset.scribeModel;
      conversation.tldrModel = preset.tldrModel;
      conversation.costTracking = {
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        costsByModel: {},
      };
    }

    this.activeConversations.set(thread.id, conversationId);
    this.contextManager.updateStatus(conversationId, "planning");

    // If there are previous messages, compile them with Scribe and TLDR
    if (previousMessages.length > 0) {
      await interaction.editReply({
        content: `📝 Compiling previous discussion (${previousMessages.length} messages)... This may take a moment.`,
      });

      // Convert Discord messages to app messages
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

      // Add messages to conversation
      for (const msg of appMessages) {
        this.contextManager.addMessage(conversationId, msg);
      }

      // Trigger Scribe to compile previous discussion
      if (conversation) {
        await this.scribeBot.notifyNewMessages(conversation);
      }

      // Wait for Scribe to complete (it's async, but we wait a bit)
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Trigger TLDR to summarize from Scribe's detailed documentation
      if (conversation) {
        await this.tldrBot.checkAndUpdate(conversation);
      }

      // Wait for TLDR to complete
      await new Promise((resolve) => setTimeout(resolve, 5000));

      if (!conversation) {
        await interaction.editReply({
          content: "Error: Conversation not found after compilation.",
        });
        return;
      }

      // Get compiled TLDR from Notion to use as input for planner
      const compiledTLDR = await this.tldrBot.getCompiledTLDR(conversation);
      
      // Create a synthetic message with the compiled TLDR for the planner
      // If TLDR is empty or not yet available, use topic with context about previous messages
      const plannerInput = compiledTLDR && compiledTLDR.trim().length > 0
        ? `Previous Discussion Summary:\n\n${compiledTLDR}\n\n---\n\nTopic: ${topic}`
        : `Topic: ${topic}\n\nNote: This thread has ${previousMessages.length} previous messages that have been compiled. Please create a plan to continue this discussion.`;
      
      const plannerInputMessage: AppMessage = {
        id: `thread-compiled-${Date.now()}`,
        conversationId,
        authorId: "system",
        authorType: "user",
        content: plannerInput,
        replyTo: [],
        timestamp: new Date(),
      };

      // Add the compiled message to conversation context
      this.contextManager.addMessage(conversationId, plannerInputMessage);

      // Now start the planner with the compiled TLDR as input
      await this.sessionPlanner.handleInitialMessage(
        conversationId,
        plannerInputMessage
      );

      const costLimit =
        conversation?.costLimit || this.config.costLimits.conversation;
      const imageCostLimit =
        conversation?.imageCostLimit || this.config.costLimits.image;
      await interaction.editReply({
        content: `✅ Previous discussion compiled!\n\n**Topic:** ${topic}\n**Task Type:** ${taskType}\n**Previous Messages:** ${previousMessages.length} compiled\n**Models:** ${preset.conversationModels.length} selected\n**Cost Limits:** Conversation: $${costLimit} | Images: $${imageCostLimit}\n\nSession Planner is now analyzing the compiled discussion and will create a plan. Use \`/sbb start\` to approve once ready.`,
      });
    } else {
      // No previous messages, just start normally
      if (conversation?.status === "planning") {
        await this.sessionPlanner.approveAndStart(conversationId);
      }

      const costLimit =
        conversation?.costLimit || this.config.costLimits.conversation;
      const imageCostLimit =
        conversation?.imageCostLimit || this.config.costLimits.image;
      await interaction.editReply({
        content: `✅ Conversation started in thread!\n\n**Topic:** ${topic}\n**Task Type:** ${taskType}\n**Models:** ${preset.conversationModels.length} selected\n**Cost Limits:** Conversation: $${costLimit} | Images: $${imageCostLimit}\n\nReady for discussion!`,
      });
    }
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
    let conversationId = this.activeConversations.get(channelId);

    if (!conversationId) {
      conversationId = `conv-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      // Detect task type and get initial models
      const taskType = detectTaskType(topic);
      const preset = getModelPreset(taskType);

      this.contextManager.createConversation(
        conversationId,
        channelId,
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
        conversation.costLimit = 50; // $50 default limit
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
      this.activeConversations.set(channelId, conversationId);
      logger.info(
        `Created new conversation ${conversationId} for ${
          thread ? "thread" : "channel"
        } ${channelId} (planning phase, task type: ${taskType})`
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
          // Start command
          .addSubcommand((subcommand) =>
            subcommand
              .setName("start")
              .setDescription(
                "Start a new conversation (in channel) or in current thread (compiles previous discussion)"
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
    // Allow commands in configured channel OR any thread in the server
    const isInConfiguredChannel =
      interaction.channel?.id === this.config.discord.channelId;
    const isInThread = interaction.channel?.isThread();
    const isInServerThread =
      isInThread && interaction.guild?.id === this.config.discord.guildId;

    if (!isInConfiguredChannel && !isInServerThread) {
      await interaction.reply({
        content:
          "This command can only be used in the configured channel or server threads.",
        ephemeral: true,
      });
      return;
    }

    try {
      if (interaction.commandName !== "sbb") {
        await interaction.reply({
          content: "Unknown command. Use /sbb for all commands.",
          ephemeral: true,
        });
        return;
      }

      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case "start":
          await this.handleStartCommand(interaction);
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
            ephemeral: true,
          });
      }
    } catch (error) {
      logger.error("Error handling slash command:", error);
      await interaction
        .reply({
          content: "An error occurred while processing the command.",
          ephemeral: true,
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
        ephemeral: true,
      });
      return;
    }

    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) {
      await interaction.reply({
        content: "Conversation not found.",
        ephemeral: true,
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
          ephemeral: true,
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
        ephemeral: true,
      });
      return;
    }

    const conversationId = this.activeConversations.get(
      interaction.channel!.id
    );
    if (!conversationId) {
      await interaction.reply({
        content: "No active conversation found. Start a conversation first.",
        ephemeral: true,
      });
      return;
    }

    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) {
      await interaction.reply({
        content: "Conversation not found.",
        ephemeral: true,
      });
      return;
    }

    if (conversation.selectedModels.includes(modelId)) {
      await interaction.reply({
        content: `Model ${modelId} is already in the conversation.`,
        ephemeral: true,
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
        ephemeral: true,
      });
      return;
    }

    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) {
      await interaction.reply({
        content: "Conversation not found.",
        ephemeral: true,
      });
      return;
    }

    const index = conversation.selectedModels.indexOf(modelId);
    if (index === -1) {
      await interaction.reply({
        content: `Model ${modelId} is not in the conversation.`,
        ephemeral: true,
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
        ephemeral: true,
      });
      return;
    }

    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) {
      await interaction.reply({
        content: "Conversation not found.",
        ephemeral: true,
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
    await interaction.deferReply({ ephemeral: true });

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
        ephemeral: true,
      });
      return;
    }

    const conversationId = this.activeConversations.get(channelId);
    if (!conversationId) {
      await interaction.reply({
        content: "No active conversation found. Start a conversation first.",
        ephemeral: true,
      });
      return;
    }

    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) {
      await interaction.reply({
        content: "Conversation not found.",
        ephemeral: true,
      });
      return;
    }

    if (conversation.status !== "paused") {
      await interaction.reply({
        content: `Conversation is not paused. Current status: ${conversation.status}`,
        ephemeral: true,
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
        ephemeral: true,
      });
      return;
    }

    const conversationId = this.activeConversations.get(channelId);
    if (!conversationId) {
      await interaction.reply({
        content: "No active conversation found.",
        ephemeral: true,
      });
      return;
    }

    const conversation = this.contextManager.getConversation(conversationId);
    if (!conversation) {
      await interaction.reply({
        content: "Conversation not found.",
        ephemeral: true,
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
        ephemeral: true,
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
        ephemeral: true,
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
        ephemeral: true,
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
    await interaction.deferReply({ ephemeral: false });

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
    await interaction.deferReply({ ephemeral: false });

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
