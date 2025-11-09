import { Client } from "@notionhq/client";
import type {
  BlockObjectResponse,
  PartialBlockObjectResponse,
  PageObjectResponse,
  PartialPageObjectResponse,
} from "@notionhq/client/build/src/api-endpoints.js";
import type { ConversationState } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { retryWithBackoff } from "../utils/retry.js";

// Type guards for Notion blocks
type NotionBlock = BlockObjectResponse | PartialBlockObjectResponse;
type NotionPage = PageObjectResponse | PartialPageObjectResponse;

function isBlockObjectResponse(
  block: NotionBlock
): block is BlockObjectResponse {
  return "type" in block;
}

function isParagraphBlock(
  block: NotionBlock
): block is BlockObjectResponse & { type: "paragraph" } {
  return isBlockObjectResponse(block) && block.type === "paragraph";
}

function isHeading3Block(
  block: NotionBlock
): block is BlockObjectResponse & { type: "heading_3" } {
  return isBlockObjectResponse(block) && block.type === "heading_3";
}

function isChildPageBlock(
  block: NotionBlock
): block is BlockObjectResponse & { type: "child_page" } {
  return isBlockObjectResponse(block) && block.type === "child_page";
}

function isChildDatabaseBlock(
  block: NotionBlock
): block is BlockObjectResponse & { type: "child_database" } {
  return isBlockObjectResponse(block) && block.type === "child_database";
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
  private pageId: string; // Page ID where database will be created
  private databaseId: string | null = null; // Database ID (cached after creation/retrieval)

  constructor(apiKey: string, pageId: string) {
    this.client = new Client({ auth: apiKey });
    this.pageId = pageId;
  }

  /**
   * Ensure database exists, create it if it doesn't
   * Returns the database ID
   */
  private async ensureDatabase(): Promise<string> {
    // If we already have a database ID, verify it still exists and has Topic property
    if (this.databaseId) {
      try {
        // Verify it still exists and has the correct schema
        const database = await this.client.databases.retrieve({
          database_id: this.databaseId,
        });
        // Check if it has a title property (Topic or Name)
        if (
          "properties" in database &&
          database.properties &&
          typeof database.properties === "object"
        ) {
          const hasTopic = "Topic" in database.properties;
          const hasName = "Name" in database.properties;
          const hasTitleProperty = Object.values(database.properties).some(
            (prop) =>
              prop &&
              typeof prop === "object" &&
              "type" in prop &&
              prop.type === "title"
          );

          if (hasTopic || (hasName && hasTitleProperty)) {
            return this.databaseId;
          }
        }
        // Database exists but doesn't have title property, reset and find/create new one
        logger.warn(
          `Database ${this.databaseId} exists but doesn't have title property, creating new one`
        );
        this.databaseId = null;
      } catch (error) {
        // Database was deleted, reset and create new one
        logger.warn(
          `Database ${this.databaseId} no longer exists, creating new one`
        );
        this.databaseId = null;
      }
    }

    // Try to find existing database in the page
    try {
      // Check if page has child databases
      const children = await this.client.blocks.children.list({
        block_id: this.pageId,
        page_size: 100,
      });

      // Look for existing database
      for (const block of children.results) {
        if (isChildDatabaseBlock(block)) {
          // Found a database, try to retrieve it
          try {
            const database = await this.client.databases.retrieve({
              database_id: block.id,
            });
            // Check if it has a title property (Topic or Name)
            if (
              "properties" in database &&
              database.properties &&
              typeof database.properties === "object"
            ) {
              // Check for Topic first, then Name (title property)
              const hasTopic = "Topic" in database.properties;
              const hasName = "Name" in database.properties;
              const hasTitleProperty = Object.values(database.properties).some(
                (prop) =>
                  prop &&
                  typeof prop === "object" &&
                  "type" in prop &&
                  prop.type === "title"
              );

              if (hasTopic || (hasName && hasTitleProperty)) {
                this.databaseId = block.id;
                logger.info(`Found existing database: ${this.databaseId}`);
                return this.databaseId;
              }
            }
          } catch (error) {
            // Database doesn't exist or can't be accessed, continue
          }
        }
      }
    } catch (error) {
      logger.warn("Failed to check for existing database:", error);
    }

    // Create new database with proper schema
    try {
      logger.info(`Creating new database in page ${this.pageId}...`);
      // Use type assertion to work around TypeScript type limitations
      // The Notion SDK types don't fully support all API features we need
      // This is a known limitation - the SDK types are incomplete
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const database = await (this.client.databases.create as any)({
        parent: {
          type: "page_id",
          page_id: this.pageId,
        },
        title: [
          {
            type: "text",
            text: {
              content: "Super Brainstorm Bot Conversations",
            },
          },
        ],
        properties: {
          Name: {
            title: {},
          },
        },
      });

      if (!database.id) {
        throw new Error("Database creation succeeded but no ID returned");
      }
      const dbId = database.id;

      // Notion creates a default "Name" property, so we need to rename it to "Topic"
      try {
        logger.info(
          `Renaming 'Name' property to 'Topic' in database ${dbId}...`
        );
        // Get the database to find the Name property ID
        const db = await this.client.databases.retrieve({
          database_id: dbId,
        });

        // Find the Name property (should be the title property)
        if ("properties" in db && db.properties) {
          const nameProperty = Object.entries(db.properties).find(
            ([_, prop]) =>
              prop &&
              typeof prop === "object" &&
              "type" in prop &&
              prop.type === "title"
          );

          if (nameProperty) {
            const [propName] = nameProperty;
            // Update the database to rename the property
            // Use type assertion due to Notion SDK type limitations (incomplete types)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (this.client.databases.update as any)({
              database_id: dbId,
              properties: {
                [propName]: {
                  name: "Topic",
                },
              },
            });
            logger.info(`Successfully renamed property to 'Topic'`);
          }
        }
      } catch (error) {
        logger.warn(
          "Failed to rename property to 'Topic', will use 'Name' instead:",
          error
        );
        // If renaming fails, we'll use "Name" as fallback
        // Update the code to handle both "Name" and "Topic"
      }

      this.databaseId = dbId;
      logger.info(`Created new database: ${dbId}`);
      return dbId;
    } catch (error) {
      logger.error("Failed to create database:", error);
      throw new Error(
        `Failed to create Notion database: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
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
      const entryId = await this.findOrCreateDatabaseEntry(
        topicName,
        conversation
      );

      // Create or update the reasoning/transcript subpage
      const subpageContent = `## Reasoning and Transcript\n\n**Status**: ${
        conversation.status
      }\n**Messages**: ${
        conversation.messageCount
      }\n**Last Updated**: ${timestamp}\n\n### Compressed Reasoning\n\n${compressedContent}\n\n### Full Transcript\n\n${this.formatTranscript(
        conversation
      )}\n\n---\n\n*Last updated: ${timestamp}*`;

      await retryWithBackoff(
        () =>
          this.updateSubpage(entryId, "Reasoning & Transcript", subpageContent),
        {
          maxRetries: 3,
          initialDelay: 1000,
          retryableErrors: [
            "rate_limit",
            "timeout",
            "network",
            "ECONNRESET",
            "ETIMEDOUT",
            "429",
          ],
        }
      );

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
      const entryId = await this.findOrCreateDatabaseEntry(
        topicName,
        conversation
      );

      // Get existing TLDR content
      const existingTLDR = await this.getExistingTLDR(entryId);

      // Append new TLDR
      const findingsText = keyFindings
        .map((f, i) => `${i + 1}. ${f}`)
        .join("\n");
      const newTLDRContent = existingTLDR
        ? `${existingTLDR}\n\n---\n\n## TLDR - ${timestamp}\n\n### Summary\n\n${summary}\n\n### Key Findings\n\n${findingsText}`
        : `## Initial Prompt\n\n${
            conversation.messages[0]?.content || "No initial prompt"
          }\n\n---\n\n## TLDR - ${timestamp}\n\n### Summary\n\n${summary}\n\n### Key Findings\n\n${findingsText}`;

      // Update TLDR in the database entry
      await retryWithBackoff(
        () => this.updateTLDRContent(entryId, newTLDRContent),
        {
          maxRetries: 3,
          initialDelay: 1000,
          retryableErrors: [
            "rate_limit",
            "timeout",
            "network",
            "ECONNRESET",
            "ETIMEDOUT",
            "429",
          ],
        }
      );

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
      const subpageId = await this.getSubpageId(
        conversation.id,
        "Reasoning & Transcript"
      );
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
      const entryId = await this.findOrCreateDatabaseEntry(
        topicName,
        conversation
      );

      // Get reasoning content from subpage
      const subpageId = await this.getSubpageId(
        entryId,
        "Reasoning & Transcript"
      );
      if (!subpageId) {
        return "";
      }

      const response = await this.client.blocks.children.list({
        block_id: subpageId,
        page_size: 100,
      });

      // Extract all content from the subpage
      const content = response.results
        .map((block): string => {
          if (isParagraphBlock(block)) {
            return block.paragraph.rich_text[0]?.plain_text || "";
          }
          if (isHeading3Block(block)) {
            return `### ${block.heading_3.rich_text[0]?.plain_text || ""}`;
          }
          return "";
        })
        .join("\n");

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
      // Ensure database exists
      const databaseId = await this.ensureDatabase();

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
        if (
          "object" in result &&
          result.object === "page" &&
          isPageObjectResponse(result)
        ) {
          // Check if this page belongs to our database
          if (
            result.parent.type === "database_id" &&
            result.parent.database_id === databaseId
          ) {
            // Check if the Topic or Name property matches (try Topic first, then Name)
            const topicProperty =
              result.properties["Topic"] || result.properties["Name"];
            if (
              topicProperty &&
              topicProperty.type === "title" &&
              "title" in topicProperty
            ) {
              const titleText = topicProperty.title[0]?.plain_text || "";
              if (titleText === topicName) {
                return result.id;
              }
            }
          }
        }
      }

      // Get the database to find the correct property name (Topic or Name)
      const db = await this.client.databases.retrieve({
        database_id: databaseId,
      });

      // Find the title property name (Topic or Name)
      let titlePropertyName = "Topic";
      if (
        "properties" in db &&
        db.properties &&
        typeof db.properties === "object"
      ) {
        if ("Topic" in db.properties) {
          titlePropertyName = "Topic";
        } else if ("Name" in db.properties) {
          titlePropertyName = "Name";
        } else {
          // Find any title property
          const titleProp = Object.entries(db.properties).find(
            ([_, prop]) =>
              prop &&
              typeof prop === "object" &&
              "type" in prop &&
              prop.type === "title"
          );
          if (titleProp) {
            titlePropertyName = titleProp[0];
          }
        }
      }

      // Create new entry
      const newPage = await this.client.pages.create({
        parent: {
          database_id: databaseId,
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
  async getTLDRForConversation(
    conversation: ConversationState
  ): Promise<string> {
    try {
      const topicName = conversation.topic || conversation.id;
      const entryId = await this.findOrCreateDatabaseEntry(
        topicName,
        conversation
      );
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
      const tldrBlocks = response.results.filter(
        (block): block is BlockObjectResponse & { type: "paragraph" } => {
          if (!isParagraphBlock(block)) return false;
          const text = block.paragraph.rich_text[0]?.plain_text || "";
          return text.includes("TLDR") || text.includes("Summary");
        }
      );

      if (tldrBlocks.length > 0) {
        return tldrBlocks
          .map((block) => block.paragraph.rich_text[0]?.plain_text || "")
          .join("\n");
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
  private async updateTLDRContent(
    entryId: string,
    content: string
  ): Promise<void> {
    try {
      // Clear existing TLDR blocks
      const existingBlocks = await this.client.blocks.children.list({
        block_id: entryId,
        page_size: 100,
      });

      const tldrBlockIds = existingBlocks.results
        .filter(
          (block): block is BlockObjectResponse & { type: "paragraph" } => {
            if (!isParagraphBlock(block)) return false;
            const text = block.paragraph.rich_text[0]?.plain_text || "";
            return text.includes("TLDR") || text.includes("Initial Prompt");
          }
        )
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
        await retryWithBackoff(
          () =>
            this.client.blocks.children.append({
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
            }),
          {
            maxRetries: 3,
            initialDelay: 1000,
            retryableErrors: [
              "rate_limit",
              "timeout",
              "network",
              "ECONNRESET",
              "ETIMEDOUT",
              "429",
            ],
          }
        );
      } else {
        // Create new subpage
        const subpage = await retryWithBackoff(
          () =>
            this.client.pages.create({
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
            }),
          {
            maxRetries: 3,
            initialDelay: 1000,
            retryableErrors: [
              "rate_limit",
              "timeout",
              "network",
              "ECONNRESET",
              "ETIMEDOUT",
              "429",
            ],
          }
        );

        // Add content to subpage
        await retryWithBackoff(
          () =>
            this.client.blocks.children.append({
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
            }),
          {
            maxRetries: 3,
            initialDelay: 1000,
            retryableErrors: [
              "rate_limit",
              "timeout",
              "network",
              "ECONNRESET",
              "ETIMEDOUT",
              "429",
            ],
          }
        );
      }
    } catch (error) {
      logger.error("Failed to update subpage:", error);
      throw error;
    }
  }

  /**
   * Get subpage ID by title
   * Note: child_page blocks don't have a direct title property,
   * so we need to fetch each page to check its title
   */
  private async getSubpageId(
    parentId: string,
    subpageTitle: string
  ): Promise<string | null> {
    try {
      const response = await this.client.blocks.children.list({
        block_id: parentId,
        page_size: 100,
      });

      // Find all child_page blocks
      const childPages = response.results.filter(
        (block): block is BlockObjectResponse & { type: "child_page" } => {
          return isChildPageBlock(block);
        }
      );

      // Check each page's title by fetching the page
      for (const childPage of childPages) {
        try {
          const page = await this.client.pages.retrieve({
            page_id: childPage.id,
          });

          // Get title from page properties
          if (isPageObjectResponse(page) && page.properties) {
            const titleProperty = Object.values(page.properties).find(
              (prop) =>
                prop &&
                typeof prop === "object" &&
                "type" in prop &&
                prop.type === "title"
            );

            if (
              titleProperty &&
              "title" in titleProperty &&
              Array.isArray(titleProperty.title)
            ) {
              const titleText = titleProperty.title[0]?.plain_text || "";
              if (titleText === subpageTitle) {
                return childPage.id;
              }
            }
          }
        } catch (error) {
          // Skip pages that can't be retrieved
          logger.warn(
            `Failed to retrieve page ${childPage.id} for title check:`,
            error
          );
          continue;
        }
      }

      return null;
    } catch (error) {
      logger.error("Failed to get subpage ID:", error);
      return null;
    }
  }

  /**
   * Find conversation entry in database
   */
  private async findConversationEntry(
    conversationId: string
  ): Promise<{ id: string } | null> {
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

      // Ensure database exists
      const databaseId = await this.ensureDatabase();

      // Filter results to find pages in our database
      for (const result of searchResponse.results) {
        // Type guard: only process page objects
        if (
          "object" in result &&
          result.object === "page" &&
          isPageObjectResponse(result)
        ) {
          // Check if this page belongs to our database
          if (
            result.parent.type === "database_id" &&
            result.parent.database_id === databaseId
          ) {
            // Check if the Topic or Name property contains the conversation ID
            const topicProperty =
              result.properties["Topic"] || result.properties["Name"];
            if (
              topicProperty &&
              topicProperty.type === "title" &&
              "title" in topicProperty
            ) {
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
      const author =
        msg.authorType === "user"
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
