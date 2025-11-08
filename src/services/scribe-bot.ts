import type {
  ConversationState,
  Message,
  Config,
  AIAdapter,
} from "../types/index.js";
import { NotionService } from "./notion-service.js";
import { AdapterRegistry } from "../adapters/index.js";
import { logger } from "../utils/logger.js";
import { PromptLoader } from "../utils/prompt-loader.js";

export class ScribeBot {
  private notionService: NotionService;
  private adapterRegistry: AdapterRegistry;
  private config: Config;
  private updateQueue: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    adapterRegistry: AdapterRegistry,
    notionService: NotionService,
    config: Config
  ) {
    this.adapterRegistry = adapterRegistry;
    this.notionService = notionService;
    this.config = config;
  }

  async notifyNewMessages(conversation: ConversationState): Promise<void> {
    // Debounce updates to avoid excessive API calls
    const existingTimeout = this.updateQueue.get(conversation.id);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(async () => {
      try {
        await this.updateReasoningDocument(conversation);
        this.updateQueue.delete(conversation.id);
      } catch (error) {
        logger.error(
          `Failed to update reasoning document for conversation ${conversation.id}:`,
          error
        );
      }
    }, this.config.scribe.updateInterval * 1000);

    this.updateQueue.set(conversation.id, timeout);
  }

  /**
   * Process messages immediately and return a promise that resolves when complete
   * Bypasses debouncing - useful when you need to wait for processing to finish
   */
  async processMessagesImmediate(conversation: ConversationState): Promise<void> {
    // Clear any pending debounced update
    const existingTimeout = this.updateQueue.get(conversation.id);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this.updateQueue.delete(conversation.id);
    }

    // Process immediately
    await this.updateReasoningDocument(conversation);
  }

  private async updateReasoningDocument(
    conversation: ConversationState
  ): Promise<void> {
    // Use conversation's scribe model or default to GPT-5
    const scribeModel = conversation.scribeModel || "openai/gpt-5";
    const adapter = this.adapterRegistry.getAdapter(scribeModel);
    if (!adapter) {
      logger.error(`Scribe adapter ${scribeModel} not found`);
      return;
    }

    // Compress the conversation
    const compressedContent = await this.compressConversation(
      conversation,
      adapter
    );

    // Update Notion
    await this.notionService.updateReasoningDocument(
      conversation,
      compressedContent
    );

    logger.info(
      `Scribe updated reasoning document for conversation ${conversation.id}`
    );
  }

  private async compressConversation(
    conversation: ConversationState,
    adapter: AIAdapter
  ): Promise<string> {
    // Format conversation for compression
    const conversationText =
      this.formatConversationForCompression(conversation);

    const systemPrompt = PromptLoader.loadPrompt("scribe-compress.txt");

    try {
      const messages: Message[] = [
        {
          id: "compress-request",
          conversationId: conversation.id,
          authorId: "system",
          authorType: "user",
          content: `Please compress and summarize this conversation:\n\n${conversationText}`,
          replyTo: [],
          timestamp: new Date(),
        },
      ];

      const response = await adapter.generateResponse(messages, systemPrompt);
      return response.content;
    } catch (error) {
      logger.error("Error compressing conversation:", error);
      // Fallback: return a simple summary
      return this.createFallbackSummary(conversation);
    }
  }

  private formatConversationForCompression(
    conversation: ConversationState
  ): string {
    const lines: string[] = [];
    lines.push(`Topic: ${conversation.topic}`);
    lines.push(`Status: ${conversation.status}`);
    lines.push(`Messages: ${conversation.messageCount}`);
    lines.push(`Tokens: ${conversation.tokenCount}`);
    lines.push("\n--- Conversation ---\n");

    conversation.messages.forEach((msg, index) => {
      const author =
        msg.authorType === "user"
          ? `User (${msg.authorId})`
          : msg.model || msg.authorId;
      const replyInfo =
        msg.replyTo.length > 0
          ? ` [Replying to: ${msg.replyTo.join(", ")}]`
          : "";
      lines.push(`[${index + 1}] ${author}${replyInfo}:`);
      lines.push(msg.content);
      lines.push("");
    });

    return lines.join("\n");
  }

  private createFallbackSummary(conversation: ConversationState): string {
    return `Conversation Summary:
Topic: ${conversation.topic}
Status: ${conversation.status}
Total Messages: ${conversation.messageCount}
Total Tokens: ${conversation.tokenCount}

Key Messages:
${conversation.messages
  .slice(-10)
  .map(
    (m, i) =>
      `${i + 1}. ${
        m.authorType === "user" ? "User" : m.model
      }: ${m.content.substring(0, 200)}...`
  )
  .join("\n")}`;
  }
}
