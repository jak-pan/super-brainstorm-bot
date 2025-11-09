import { loadConfig } from "./config/index.js";
import { AdapterRegistry } from "./adapters/index.js";
import { NotionService } from "./services/notion-service.js";
import { ContextManager } from "./services/context-manager.js";
import {
  ConversationCoordinator,
  ResponseCallback,
} from "./services/conversation-coordinator.js";
import { ScribeBot } from "./services/scribe-bot.js";
import { TLDRBot } from "./services/tldr-bot.js";
import { ImageBot } from "./services/image-bot.js";
import { SessionPlanner, PlannerCallback } from "./services/session-planner.js";
import { DiscordBot } from "./bot/discord-bot.js";
import { logger } from "./utils/logger.js";
import { getConversationChannelId } from "./utils/conversation-utils.js";
import { DISCORD_CHANNEL_TYPES } from "./utils/constants.js";
import type { AIResponse } from "./types/index.js";
import type { Message as DiscordMessage } from "discord.js";
import { TextChannel, ThreadChannel } from "discord.js";

async function main() {
  try {
    logger.info("Starting Super Brainstorm Bot...");

    // Load configuration
    const config = loadConfig();
    logger.info("Configuration loaded");

    // Initialize Notion service
    const notionService = new NotionService(
      config.notion.apiKey,
      config.notion.databaseId
    );
    logger.info("Notion service initialized");

    // Initialize adapter registry
    const adapterRegistry = new AdapterRegistry(config);
    logger.info(`Adapter registry initialized with default models`);

    // Initialize context manager
    const contextManager = new ContextManager(notionService, config);
    logger.info("Context manager initialized");

    // Initialize scribe, TLDR, and image bots
    const scribeBot = new ScribeBot(adapterRegistry, notionService, config);
    const tldrBot = new TLDRBot(adapterRegistry, notionService, config);
    const imageBot = new ImageBot(config);
    logger.info("Scribe, TLDR, and Image bots initialized");

    // Create response callback for Discord
    let discordBotInstance: DiscordBot | null = null;
    const responseCallback: ResponseCallback = async (
      response: AIResponse & { conversationId: string }
    ) => {
      if (!discordBotInstance) return;

      const conversation = contextManager.getConversation(
        response.conversationId
      );
      const channelId = getConversationChannelId(conversation);

      if (!channelId) {
        logger.warn(
          `No channel ID found for conversation ${response.conversationId}`
        );
        return;
      }

      const channel = discordBotInstance.client.channels.cache.get(channelId);
      if (!channel) {
        logger.warn(
          `Discord channel/thread ${channelId} not available for posting response`
        );
        return;
      }

      // Type guard for TextChannel or ThreadChannel
      if (
        channel.type !== DISCORD_CHANNEL_TYPES.GUILD_TEXT &&
        channel.type !== DISCORD_CHANNEL_TYPES.GUILD_PUBLIC_THREAD
      ) {
        logger.warn(`Channel ${channelId} is not a text channel or thread`);
        return;
      }

      logger.info(
        `Posting response from ${response.model} for conversation ${response.conversationId}`
      );
      await discordBotInstance.postAIResponse(
        channel as TextChannel | ThreadChannel,
        {
          content: response.content,
          replyTo: response.replyTo,
          model: response.model,
        },
        response.conversationId
      );
    };

    // Create planner callback for Discord
    const plannerCallback: PlannerCallback = async (
      message: string,
      replyTo?: string,
      conversationId?: string
    ) => {
      if (!discordBotInstance) return;

      let targetChannel: TextChannel | ThreadChannel | null = null;

      if (conversationId) {
        const conversation = contextManager.getConversation(conversationId);
        if (conversation) {
          const channelId = getConversationChannelId(conversation);

          if (channelId) {
            // Try cache first
            let channel =
              discordBotInstance.client.channels.cache.get(channelId);

            // If not in cache, try to fetch it
            if (!channel) {
              try {
                const fetchedChannel =
                  await discordBotInstance.client.channels.fetch(channelId);
                if (fetchedChannel) {
                  channel = fetchedChannel;
                }
              } catch (error) {
                logger.warn(`Failed to fetch channel ${channelId}:`, error);
              }
            }

            if (
              channel &&
              (channel.type === DISCORD_CHANNEL_TYPES.GUILD_TEXT ||
                channel.type === DISCORD_CHANNEL_TYPES.GUILD_PUBLIC_THREAD)
            ) {
              targetChannel = channel as TextChannel | ThreadChannel;
            }
          }
        }
      }

      if (!targetChannel) {
        logger.warn(
          `Discord channel not available for posting planner message (conversationId: ${conversationId})`
        );
        return;
      }

      try {
        let replyToMessage: DiscordMessage | null = null;
        if (replyTo) {
          try {
            replyToMessage = await targetChannel.messages
              .fetch(replyTo)
              .catch(() => null);
          } catch (error) {
            logger.warn("Failed to fetch reply message:", error);
          }
        }

        await targetChannel.send({
          content: message,
          reply: replyToMessage
            ? { messageReference: replyToMessage }
            : undefined,
        });
      } catch (error) {
        logger.error("Error posting planner message:", error);
      }
    };

    // Initialize session planner
    const sessionPlanner = new SessionPlanner(
      adapterRegistry,
      contextManager,
      config,
      plannerCallback
    );
    logger.info("Session planner initialized");

    // Initialize conversation coordinator
    const conversationCoordinator = new ConversationCoordinator(
      contextManager,
      adapterRegistry,
      config,
      responseCallback
    );
    logger.info("Conversation coordinator initialized");

    // Initialize Discord bot
    const discordBot = new DiscordBot(
      config,
      conversationCoordinator,
      contextManager,
      scribeBot,
      tldrBot,
      imageBot,
      sessionPlanner
    );
    discordBotInstance = discordBot;
    logger.info("Discord bot initialized");

    // Start the bot
    await discordBot.start();

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      logger.info("Received SIGINT, shutting down gracefully...");
      await discordBot.stop();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      logger.info("Received SIGTERM, shutting down gracefully...");
      await discordBot.stop();
      process.exit(0);
    });

    logger.info("Super Brainstorm Bot is running!");

    // Start health check server for Docker/cloud deployments
    // Always enabled in production, or when ENABLE_HEALTH_CHECK is explicitly set
    const shouldEnableHealthCheck =
      process.env.NODE_ENV === "production" ||
      process.env.ENABLE_HEALTH_CHECK === "true";

    if (shouldEnableHealthCheck) {
      const http = await import("http");
      const healthServer = http.default.createServer((req, res) => {
        if (req.url === "/health") {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("OK");
        } else {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
        }
      });

      const port = parseInt(process.env.HEALTH_CHECK_PORT || "3000", 10);
      healthServer.listen(port, () => {
        logger.info(`Health check server listening on port ${port}`);
      });

      // Handle server errors gracefully
      healthServer.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          logger.warn(
            `Port ${port} is already in use, health check server not started`
          );
        } else {
          logger.error("Health check server error:", error);
        }
      });
    }
  } catch (error) {
    logger.error("Fatal error:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error("Unhandled error:", error);
  process.exit(1);
});
