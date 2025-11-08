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

export class TLDRBot {
  private notionService: NotionService;
  private adapterRegistry: AdapterRegistry;
  private config: Config;
  private lastUpdate: Map<string, number> = new Map();

  constructor(
    adapterRegistry: AdapterRegistry,
    notionService: NotionService,
    config: Config
  ) {
    this.adapterRegistry = adapterRegistry;
    this.notionService = notionService;
    this.config = config;
  }

  async checkAndUpdate(conversation: ConversationState): Promise<void> {
    const now = Date.now();
    const lastUpdateTime = this.lastUpdate.get(conversation.id) || 0;
    const timeSinceUpdate = now - lastUpdateTime;

    // Only update if enough time has passed
    if (timeSinceUpdate < this.config.tldr.updateInterval * 1000) {
      return;
    }

    try {
      await this.updateTLDR(conversation);
      this.lastUpdate.set(conversation.id, now);
    } catch (error) {
      logger.error(
        `Failed to update TLDR for conversation ${conversation.id}:`,
        error
      );
    }
  }

  private async updateTLDR(conversation: ConversationState): Promise<void> {
    const adapter = this.adapterRegistry.getAdapter(this.config.tldr.model);
    if (!adapter) {
      logger.error(`TLDR adapter ${this.config.tldr.model} not found`);
      return;
    }

    // Get detailed documentation from Notion (scribe's verbose content)
    const scribeContent = await this.notionService.getLatestReasoningContent(
      conversation
    );

    if (!scribeContent) {
      logger.warn(
        `No scribe content found for conversation ${conversation.id}, skipping TLDR update`
      );
      return;
    }

    // Generate summary and key findings from scribe's detailed documentation
    const { summary, keyFindings } = await this.generateTLDR(
      conversation,
      adapter,
      scribeContent
    );

    // Update Notion
    await this.notionService.updateTLDR(summary, keyFindings);

    logger.info(`TLDR updated for conversation ${conversation.id}`);
  }

  private async generateTLDR(
    conversation: ConversationState,
    adapter: AIAdapter,
    scribeContent: string
  ): Promise<{ summary: string; keyFindings: string[] }> {
    const systemPrompt = PromptLoader.loadPrompt("tldr-summary.txt");

    try {
      const messages: Message[] = [
        {
          id: "tldr-request",
          conversationId: conversation.id,
          authorId: "system",
          authorType: "user",
          content: `Please create a TLDR from this detailed conversation documentation:\n\n${scribeContent}`,
          replyTo: [],
          timestamp: new Date(),
        },
      ];

      const response = await adapter.generateResponse(messages, systemPrompt);

      // Try to parse JSON response
      try {
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            summary: parsed.summary || response.content,
            keyFindings: Array.isArray(parsed.keyFindings)
              ? parsed.keyFindings
              : [],
          };
        }
      } catch (parseError) {
        logger.warn("Failed to parse TLDR JSON, using full response");
      }

      // Fallback: extract summary and findings from text
      return this.extractTLDRFromText(response.content);
    } catch (error) {
      logger.error("Error generating TLDR:", error);
      return this.createFallbackTLDR(conversation);
    }
  }

  private extractTLDRFromText(text: string): {
    summary: string;
    keyFindings: string[];
  } {
    // Try to extract summary and findings from structured text
    const summaryMatch = text.match(/summary[:\s]+(.*?)(?=key|findings|$)/is);
    const findingsMatch = text.match(
      /(?:key\s+findings|findings)[:\s]+(.*?)$/is
    );

    const summary = summaryMatch
      ? summaryMatch[1].trim()
      : text.substring(0, 500);
    const findingsText = findingsMatch ? findingsMatch[1] : "";

    // Extract bullet points or numbered items
    const findings = findingsText
      .split(/\n|•|[-*]/)
      .map((f) => f.trim())
      .filter((f) => f.length > 0 && !f.match(/^\d+\.?\s*$/))
      .slice(0, 5);

    return {
      summary,
      keyFindings:
        findings.length > 0 ? findings : ["No specific findings extracted"],
    };
  }

  private createFallbackTLDR(conversation: ConversationState): {
    summary: string;
    keyFindings: string[];
  } {
    return {
      summary: `Discussion on "${conversation.topic}" with ${conversation.messageCount} messages. Status: ${conversation.status}.`,
      keyFindings: [
        `Total messages: ${conversation.messageCount}`,
        `Total tokens used: ${conversation.tokenCount}`,
        `Status: ${conversation.status}`,
      ],
    };
  }
}
