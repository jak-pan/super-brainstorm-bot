import { Client } from "@notionhq/client";
import type { ConversationState } from "../types/index.js";
import { logger } from "../utils/logger.js";

export class NotionService {
  private client: Client;
  private reasoningPageId: string;
  private tldrPageId: string;

  constructor(apiKey: string, reasoningPageId: string, tldrPageId: string) {
    this.client = new Client({ auth: apiKey });
    this.reasoningPageId = reasoningPageId;
    this.tldrPageId = tldrPageId;
  }

  async updateReasoningDocument(
    conversation: ConversationState,
    compressedContent: string
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const content = `## Conversation: ${conversation.topic}\n\n**Status**: ${conversation.status}\n**Messages**: ${conversation.messageCount}\n**Tokens**: ${conversation.tokenCount}\n\n### Compressed Reasoning\n\n${compressedContent}\n\n---\n\n*Last updated: ${timestamp}*`;

      await this.client.blocks.children.append({
        block_id: this.reasoningPageId,
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                {
                  type: "text",
                  text: {
                    content: content,
                  },
                },
              ],
            },
          },
        ],
      });

      logger.info("Updated Notion reasoning document");
    } catch (error) {
      logger.error("Failed to update Notion reasoning document:", error);
      throw error;
    }
  }

  async updateTLDR(summary: string, keyFindings: string[]): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const findingsText = keyFindings
        .map((f, i) => `${i + 1}. ${f}`)
        .join("\n");
      const content = `## TLDR - ${timestamp}\n\n### Summary\n\n${summary}\n\n### Key Findings\n\n${findingsText}`;

      await this.client.blocks.children.append({
        block_id: this.tldrPageId,
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                {
                  type: "text",
                  text: {
                    content: content,
                  },
                },
              ],
            },
          },
        ],
      });

      logger.info("Updated Notion TLDR document");
    } catch (error) {
      logger.error("Failed to update Notion TLDR document:", error);
      throw error;
    }
  }

  async getCompressedContext(conversationId: string): Promise<string> {
    try {
      const response = await this.client.blocks.children.list({
        block_id: this.reasoningPageId,
        page_size: 100,
      });

      // Find the most recent entry for this conversation
      // This is a simplified version - in production, you'd want better filtering
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks = response.results.filter(
        (block: any) =>
          block.type === "paragraph" &&
          block.paragraph?.rich_text?.[0]?.plain_text?.includes(conversationId)
      );

      if (blocks.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const latestBlock = blocks[blocks.length - 1] as any;
        return latestBlock.paragraph?.rich_text?.[0]?.plain_text || "";
      }

      return "";
    } catch (error) {
      logger.error("Failed to get compressed context from Notion:", error);
      return "";
    }
  }

  /**
   * Get the latest reasoning document content for a conversation
   * Used by TLDR bot to extract summaries from scribe's detailed documentation
   */
  async getLatestReasoningContent(
    conversation: ConversationState
  ): Promise<string> {
    try {
      const response = await this.client.blocks.children.list({
        block_id: this.reasoningPageId,
        page_size: 100,
      });

      // Find blocks that contain this conversation's topic
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks = response.results.filter((block: any) => {
        if (block.type !== "paragraph") return false;
        const text = block.paragraph?.rich_text?.[0]?.plain_text || "";
        return (
          text.includes(conversation.topic) || text.includes(conversation.id)
        );
      });

      if (blocks.length > 0) {
        // Get the most recent block (last in the list)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const latestBlock = blocks[blocks.length - 1] as any;
        const content = latestBlock.paragraph?.rich_text?.[0]?.plain_text || "";

        // Extract the "Compressed Reasoning" section if it exists
        const reasoningMatch = content.match(
          /### Compressed Reasoning\s*\n\n(.*?)(?=\n\n---|$)/s
        );
        if (reasoningMatch) {
          return reasoningMatch[1].trim();
        }

        // If no specific section found, return the full content
        return content;
      }

      return "";
    } catch (error) {
      logger.error(
        "Failed to get latest reasoning content from Notion:",
        error
      );
      return "";
    }
  }
}
