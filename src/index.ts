import { loadConfig } from './config/index.js';
import { AdapterRegistry } from './adapters/index.js';
import { NotionService } from './services/notion-service.js';
import { ContextManager } from './services/context-manager.js';
import { ConversationCoordinator, ResponseCallback } from './services/conversation-coordinator.js';
import { ScribeBot } from './services/scribe-bot.js';
import { TLDRBot } from './services/tldr-bot.js';
import { SessionPlanner, PlannerCallback } from './services/session-planner.js';
import { DiscordBot } from './bot/discord-bot.js';
import { logger } from './utils/logger.js';
import type { AIResponse, AIAdapter } from './types/index.js';
import type { Message as DiscordMessage } from 'discord.js';

async function main() {
  try {
    logger.info('Starting Super Brainstorm Bot...');

    // Load configuration
    const config = loadConfig();
    logger.info('Configuration loaded');

    // Initialize Notion service
    const notionService = new NotionService(
      config.notion.apiKey,
      config.notion.reasoningPageId,
      config.notion.tldrPageId
    );
    logger.info('Notion service initialized');

    // Initialize adapter registry
    const adapterRegistry = new AdapterRegistry(config);
    const adapters = new Map<string, AIAdapter>();
    adapterRegistry.getAllAdapters().forEach((adapter) => {
      adapters.set(adapter.getModelName().toLowerCase(), adapter);
      adapters.set(adapter.getModelName(), adapter);
    });
    logger.info(`Registered ${adapters.size / 2} AI adapters: ${adapterRegistry.getAvailableAdapters().join(', ')}`);

    // Initialize context manager
    const contextManager = new ContextManager(notionService, config);
    logger.info('Context manager initialized');

    // Initialize scribe and TLDR bots
    const scribeBot = new ScribeBot(adapterRegistry, notionService, config);
    const tldrBot = new TLDRBot(adapterRegistry, notionService, config);
    logger.info('Scribe and TLDR bots initialized');

    // Create response callback for Discord
    let discordBotInstance: DiscordBot | null = null;
    const responseCallback: ResponseCallback = async (response: AIResponse & { conversationId: string }) => {
      if (!discordBotInstance) return;

      const channel = discordBotInstance.getChannel();
      if (!channel) {
        logger.warn('Discord channel not available for posting response');
        return;
      }

      await discordBotInstance.postAIResponse(channel, {
        content: response.content,
        replyTo: response.replyTo,
        model: response.model,
      });
    };

    // Create planner callback for Discord
    const plannerCallback: PlannerCallback = async (message: string, replyTo?: string) => {
      if (!discordBotInstance) return;

      const channel = discordBotInstance.getChannel();
      if (!channel) {
        logger.warn('Discord channel not available for posting planner message');
        return;
      }

      try {
        let replyToMessage: DiscordMessage | null = null;
        if (replyTo) {
          try {
            replyToMessage = await channel.messages.fetch(replyTo).catch(() => null);
          } catch (error) {
            logger.warn('Failed to fetch reply message:', error);
          }
        }

        await channel.send({
          content: message,
          reply: replyToMessage ? { messageReference: replyToMessage } : undefined,
        });
      } catch (error) {
        logger.error('Error posting planner message:', error);
      }
    };

    // Initialize session planner
    const sessionPlanner = new SessionPlanner(
      adapterRegistry,
      contextManager,
      config,
      plannerCallback
    );
    logger.info('Session planner initialized');

    // Initialize conversation coordinator
    const conversationCoordinator = new ConversationCoordinator(
      contextManager,
      adapters,
      config,
      responseCallback
    );
    logger.info('Conversation coordinator initialized');

    // Initialize Discord bot
    const discordBot = new DiscordBot(
      config,
      conversationCoordinator,
      contextManager,
      scribeBot,
      tldrBot,
      sessionPlanner
    );
    discordBotInstance = discordBot;
    logger.info('Discord bot initialized');

    // Start the bot
    await discordBot.start();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      await discordBot.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      await discordBot.stop();
      process.exit(0);
    });

    logger.info('Super Brainstorm Bot is running!');

    // Optional: Start health check server for Docker/cloud deployments
    if (process.env.ENABLE_HEALTH_CHECK === 'true') {
      const http = await import('http');
      const healthServer = http.default.createServer((req, res) => {
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('OK');
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        }
      });

      const port = parseInt(process.env.HEALTH_CHECK_PORT || '3000', 10);
      healthServer.listen(port, () => {
        logger.info(`Health check server listening on port ${port}`);
      });
    }
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});

