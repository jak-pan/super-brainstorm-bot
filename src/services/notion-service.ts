import { Client } from "@notionhq/client";
import type { 
  BlockObjectResponse, 
  PartialBlockObjectResponse,
  PageObjectResponse,
  PartialPageObjectResponse
} from "@notionhq/client/build/src/api-endpoints.js";
import type { ConversationState } from "../types/index.js";
import { logger } from "../utils/logger.js";

// Type guards for Notion blocks
type NotionBlock = BlockObjectResponse | PartialBlockObjectResponse;
type NotionPage = PageObjectResponse | PartialPageObjectResponse;

function isBlockObjectResponse(block: NotionBlock): block is BlockObjectResponse {
  return "type" in block;
}

function isParagraphBlock(block: NotionBlock): block is BlockObjectResponse & { type: "paragraph" } {
  return isBlockObjectResponse(block) && block.type === "paragraph";
}

function isHeading3Block(block: NotionBlock): block is BlockObjectResponse & { type: "heading_3" } {
  return isBlockObjectResponse(block) && block.type === "heading_3";
}

function isChildPageBlock(block: NotionBlock): block is BlockObjectResponse & { type: "child_page" } {
  return isBlockObjectResponse(block) && block.type === "child_page";
}

function isPageObjectResponse(page: NotionPage): page is PageObjectResponse {
  return "id" in page && "properties" in page;
}

/**
 * NotionService - Manages Notion integration with unified database structure
 * 
 * Structure:
 * - Single database/page (NOTION_PAGE_ID)
 * - Each entry represents a topic/thread
 * - Entry contains: Topic name, TLDR content (first prompt + subsequent TLDRs)
 * - Subpage contains: Reasoning and transcript
 */
export class NotionService {
  private client: Client;
  private databaseId: string; // Single database/page ID
  private topicPropertyName: string; // Name of the property used for topic/title

  constructor(apiKey: string, databaseId: string, topicPropertyName?: string) {
    this.client = new Client({ auth: apiKey });
    this.databaseId = databaseId;
    this.topicPropertyName = topicPropertyName || "Topic";
  }

  /**
   * Get the title property name from the database schema
   */
  private async getTitlePropertyName(): Promise<string> {
    try {
      const database = await this.client.databases.retrieve({
        database_id: this.databaseId,
      });

      // Check if database has properties (might be partial response)
      if ("properties" in database && database.properties) {
        // Find the first title property
        for (const [key, value] of Object.entries(database.properties)) {
          if (value && typeof value === "object" && "type" in value && value.type === "title") {
            return key;
          }
        }
      }

      // Fallback to configured name or "Topic"
      return this.topicPropertyName;
    } catch (error) {
      logger.warn("Failed to retrieve database schema, using default property name:", error);
      return this.topicPropertyName;
    }
  }

  /**
   * Update or create a database entry for the conversation topic
   * Creates/updates the reasoning and transcript subpage
   */
  async updateReasoningDocument(
    conversation: ConversationState,
    compressedContent: string
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const topicName = conversation.topic || conversation.id;
      
      // Find or create database entry for this topic
      const entryId = await this.findOrCreateDatabaseEntry(topicName, conversation);
      
      // Create or update the reasoning/transcript subpage
      const subpageContent = `## Reasoning and Transcript\n\n**Status**: ${conversation.status}\n**Messages**: ${conversation.messageCount}\n**Last Updated**: ${timestamp}\n\n### Compressed Reasoning\n\n${compressedContent}\n\n### Full Transcript\n\n${this.formatTranscript(conversation)}\n\n---\n\n*Last updated: ${timestamp}*`;
      
      await this.updateSubpage(entryId, "Reasoning & Transcript", subpageContent);

      logger.info(`Updated Notion reasoning document for topic: ${topicName}`);
    } catch (error) {
      logger.error("Failed to update Notion reasoning document:", error);
      throw error;
    }
  }

  /**
   * Update TLDR for a conversation topic
   * Appends to existing TLDR content (first prompt + subsequent TLDRs)
   */
  async updateTLDR(
    conversation: ConversationState,
    summary: string,
    keyFindings: string[]
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const topicName = conversation.topic || conversation.id;
      
      // Find or create database entry
      const entryId = await this.findOrCreateDatabaseEntry(topicName, conversation);
      
      // Get existing TLDR content
      const existingTLDR = await this.getExistingTLDR(entryId);
      
      // Append new TLDR
      const findingsText = keyFindings
        .map((f, i) => `${i + 1}. ${f}`)
        .join("\n");
      const newTLDRContent = existingTLDR 
        ? `${existingTLDR}\n\n---\n\n## TLDR - ${timestamp}\n\n### Summary\n\n${summary}\n\n### Key Findings\n\n${findingsText}`
        : `## Initial Prompt\n\n${conversation.messages[0]?.content || "No initial prompt"}\n\n---\n\n## TLDR - ${timestamp}\n\n### Summary\n\n${summary}\n\n### Key Findings\n\n${findingsText}`;
      
      // Update TLDR in the database entry
      await this.updateTLDRContent(entryId, newTLDRContent);

      logger.info(`Updated Notion TLDR for topic: ${topicName}`);
    } catch (error) {
      logger.error("Failed to update Notion TLDR document:", error);
      throw error;
    }
  }

  async getCompressedContext(conversationId: string): Promise<string> {
    try {
      // Find database entry by conversation ID or topic
      const conversation = await this.findConversationEntry(conversationId);
      if (!conversation) {
        return "";
      }

      // Get reasoning content from subpage
      const subpageId = await this.getSubpageId(conversation.id, "Reasoning & Transcript");
      if (!subpageId) {
        return "";
      }

      const response = await this.client.blocks.children.list({
        block_id: subpageId,
        page_size: 100,
      });

      // Extract compressed reasoning section
      const blocks = response.results.filter((block): block is NotionBlock => {
        if (!isBlockObjectResponse(block)) return false;
        return block.type === "paragraph" || block.type === "heading_3";
      });

      let reasoningContent = "";
      let inReasoningSection = false;

      for (const block of blocks) {
        let text = "";
        if (isParagraphBlock(block)) {
          text = block.paragraph.rich_text[0]?.plain_text || "";
        } else if (isHeading3Block(block)) {
          text = block.heading_3.rich_text[0]?.plain_text || "";
        }
        
        if (text.includes("Compressed Reasoning")) {
          inReasoningSection = true;
          continue;
        }
        
        if (inReasoningSection) {
          if (text.includes("Full Transcript") || text.includes("---")) {
            break;
          }
          reasoningContent += text + "\n";
        }
      }

      return reasoningContent.trim();
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
      const topicName = conversation.topic || conversation.id;
      const entryId = await this.findOrCreateDatabaseEntry(topicName, conversation);
      
      // Get reasoning content from subpage
      const subpageId = await this.getSubpageId(entryId, "Reasoning & Transcript");
      if (!subpageId) {
        return "";
      }

      const response = await this.client.blocks.children.list({
        block_id: subpageId,
        page_size: 100,
      });

      // Extract all content from the subpage
      const content = response.results.map((block): string => {
        if (isParagraphBlock(block)) {
          return block.paragraph.rich_text[0]?.plain_text || "";
        }
        if (isHeading3Block(block)) {
          return `### ${block.heading_3.rich_text[0]?.plain_text || ""}`;
        }
        return "";
      }).join("\n");

      // Extract the "Compressed Reasoning" section if it exists
      const reasoningMatch = content.match(
        /### Compressed Reasoning\s*\n\n(.*?)(?=\n\n### Full Transcript|$)/s
      );
      if (reasoningMatch) {
        return reasoningMatch[1].trim();
      }

      // If no specific section found, return the full content
      return content;
    } catch (error) {
      logger.error(
        "Failed to get latest reasoning content from Notion:",
        error
      );
      return "";
    }
  }

  /**
   * Find or create a database entry for a topic
   * Returns the page ID of the entry
   */
  private async findOrCreateDatabaseEntry(
    topicName: string,
    _conversation: ConversationState
  ): Promise<string> {
    try {
      // Get the actual title property name from the database schema
      const titlePropertyName = await this.getTitlePropertyName();

      // Search for existing entry with this topic name using search API
      const searchResponse = await this.client.search({
        query: topicName,
        filter: {
          property: "object",
          value: "page",
        },
        sort: {
          direction: "descending",
          timestamp: "last_edited_time",
        },
      });

      // Filter results to find pages in our database with matching topic
      for (const result of searchResponse.results) {
        // Type guard: only process page objects
        if ("object" in result && result.object === "page" && isPageObjectResponse(result)) {
          // Check if this page belongs to our database
          if (result.parent.type === "database_id" && result.parent.database_id === this.databaseId) {
            // Check if the topic property matches (try configured name first, then any title property)
            let topicProperty = result.properties[titlePropertyName];
            if (!topicProperty || topicProperty.type !== "title") {
              // Fallback: find any title property
              for (const prop of Object.values(result.properties)) {
                if (prop && typeof prop === "object" && "type" in prop && prop.type === "title") {
                  topicProperty = prop;
                  break;
                }
              }
            }
            if (topicProperty && topicProperty.type === "title" && "title" in topicProperty) {
              const titleText = topicProperty.title[0]?.plain_text || "";
              if (titleText === topicName) {
                return result.id;
              }
            }
          }
        }
      }

      // Create new entry using the detected title property name
      const newPage = await this.client.pages.create({
        parent: {
          database_id: this.databaseId,
        },
        properties: {
          [titlePropertyName]: {
            title: [
              {
                text: {
                  content: topicName,
                },
              },
            ],
          },
        },
      });

      return newPage.id;
    } catch (error) {
      logger.error("Failed to find or create database entry:", error);
      throw error;
    }
  }

  /**
   * Get TLDR content for a conversation
   * Public method to retrieve compiled TLDR from Notion
   */
  async getTLDRForConversation(conversation: ConversationState): Promise<string> {
    try {
      const topicName = conversation.topic || conversation.id;
      const entryId = await this.findOrCreateDatabaseEntry(topicName, conversation);
      return await this.getExistingTLDR(entryId);
    } catch (error) {
      logger.error("Failed to get TLDR for conversation:", error);
      return "";
    }
  }

  /**
   * Get existing TLDR content from database entry
   */
  private async getExistingTLDR(entryId: string): Promise<string> {
    try {
      const response = await this.client.blocks.children.list({
        block_id: entryId,
        page_size: 100,
      });

      // Find TLDR content block
      const tldrBlocks = response.results.filter((block): block is BlockObjectResponse & { type: "paragraph" } => {
        if (!isParagraphBlock(block)) return false;
        const text = block.paragraph.rich_text[0]?.plain_text || "";
        return text.includes("TLDR") || text.includes("Summary");
      });

      if (tldrBlocks.length > 0) {
        return tldrBlocks.map((block) => 
          block.paragraph.rich_text[0]?.plain_text || ""
        ).join("\n");
      }

      return "";
    } catch (error) {
      logger.error("Failed to get existing TLDR:", error);
      return "";
    }
  }

  /**
   * Update TLDR content in database entry
   */
  private async updateTLDRContent(entryId: string, content: string): Promise<void> {
    try {
      // Clear existing TLDR blocks
      const existingBlocks = await this.client.blocks.children.list({
        block_id: entryId,
        page_size: 100,
      });

      const tldrBlockIds = existingBlocks.results
        .filter((block): block is BlockObjectResponse & { type: "paragraph" } => {
          if (!isParagraphBlock(block)) return false;
          const text = block.paragraph.rich_text[0]?.plain_text || "";
          return text.includes("TLDR") || text.includes("Initial Prompt");
        })
        .map((block) => block.id);

      // Delete old TLDR blocks
      for (const blockId of tldrBlockIds) {
        await this.client.blocks.delete({ block_id: blockId });
      }

      // Add new TLDR content
      await this.client.blocks.children.append({
        block_id: entryId,
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
    } catch (error) {
      logger.error("Failed to update TLDR content:", error);
      throw error;
    }
  }

  /**
   * Create or update a subpage with given title and content
   */
  private async updateSubpage(
    parentId: string,
    subpageTitle: string,
    content: string
  ): Promise<void> {
    try {
      // Check if subpage already exists
      const subpageId = await this.getSubpageId(parentId, subpageTitle);
      
      if (subpageId) {
        // Update existing subpage
        await this.client.blocks.children.append({
          block_id: subpageId,
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
      } else {
        // Create new subpage
        const subpage = await this.client.pages.create({
          parent: {
            page_id: parentId,
          },
          properties: {
            title: {
              title: [
                {
                  text: {
                    content: subpageTitle,
                  },
                },
              ],
            },
          },
        });

        // Add content to subpage
        await this.client.blocks.children.append({
          block_id: subpage.id,
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
      }
    } catch (error) {
      logger.error("Failed to update subpage:", error);
      throw error;
    }
  }

  /**
   * Get subpage ID by title
   */
  private async getSubpageId(parentId: string, subpageTitle: string): Promise<string | null> {
    try {
      const response = await this.client.blocks.children.list({
        block_id: parentId,
        page_size: 100,
      });

      const subpage = response.results.find((block): block is BlockObjectResponse & { type: "child_page" } => {
        if (!isChildPageBlock(block)) return false;
        return block.child_page.title === subpageTitle;
      });

      return subpage ? subpage.id : null;
    } catch (error) {
      logger.error("Failed to get subpage ID:", error);
      return null;
    }
  }

  /**
   * Find conversation entry in database
   */
  private async findConversationEntry(conversationId: string): Promise<{ id: string } | null> {
    try {
      // Search for existing entry using search API
      const searchResponse = await this.client.search({
        query: conversationId,
        filter: {
          property: "object",
          value: "page",
        },
        sort: {
          direction: "descending",
          timestamp: "last_edited_time",
        },
      });

      // Get the actual title property name from the database schema
      const titlePropertyName = await this.getTitlePropertyName();

      // Filter results to find pages in our database
      for (const result of searchResponse.results) {
        // Type guard: only process page objects
        if ("object" in result && result.object === "page" && isPageObjectResponse(result)) {
          // Check if this page belongs to our database
          if (result.parent.type === "database_id" && result.parent.database_id === this.databaseId) {
            // Check if the topic property contains the conversation ID (try configured name first, then any title property)
            let topicProperty = result.properties[titlePropertyName];
            if (!topicProperty || topicProperty.type !== "title") {
              // Fallback: find any title property
              for (const prop of Object.values(result.properties)) {
                if (prop && typeof prop === "object" && "type" in prop && prop.type === "title") {
                  topicProperty = prop;
                  break;
                }
              }
            }
            if (topicProperty && topicProperty.type === "title" && "title" in topicProperty) {
              const titleText = topicProperty.title[0]?.plain_text || "";
              if (titleText.includes(conversationId)) {
                return { id: result.id };
              }
            }
          }
        }
      }

      return null;
    } catch (error) {
      logger.error("Failed to find conversation entry:", error);
      return null;
    }
  }

  /**
   * Format conversation transcript
   */
  private formatTranscript(conversation: ConversationState): string {
    const lines: string[] = [];
    
    conversation.messages.forEach((msg, index) => {
      const author = msg.authorType === "user"
        ? `User (${msg.authorId})`
        : msg.model || msg.authorId;
      const timestamp = msg.timestamp.toISOString();
      lines.push(`[${index + 1}] ${author} (${timestamp}):`);
      lines.push(msg.content);
      lines.push("");
    });

    return lines.join("\n");
  }
}
