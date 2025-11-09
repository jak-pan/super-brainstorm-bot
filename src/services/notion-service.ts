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
 * - Entry contains: Name (topic name), TLDR content (first prompt + subsequent TLDRs)
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
    // Always check for existing database first (don't rely on cached ID)
    // This ensures we reuse the database even if the service instance is recreated
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
            // Check if it has a Name property (title property)
            if (
              "properties" in database &&
              database.properties &&
              typeof database.properties === "object" &&
              "Name" in database.properties
            ) {
              this.databaseId = block.id;
              logger.info(`Found existing database: ${this.databaseId}`);
              return this.databaseId;
            }
          } catch (error) {
            // Database doesn't exist or can't be accessed, continue
            logger.warn(
              `Failed to retrieve database ${block.id}, continuing search:`,
              error
            );
          }
        }
      }
    } catch (error) {
      logger.warn("Failed to check for existing database:", error);
    }

    // If we have a cached database ID, verify it still exists
    if (this.databaseId) {
      try {
        const database = await this.client.databases.retrieve({
          database_id: this.databaseId,
        });
        // Check if it has a Name property
        if (
          "properties" in database &&
          database.properties &&
          typeof database.properties === "object" &&
          "Name" in database.properties
        ) {
          logger.info(`Using cached database: ${this.databaseId}`);
          return this.databaseId;
        }
        // Database exists but doesn't have Name property, reset
        logger.warn(
          `Cached database ${this.databaseId} doesn't have Name property, will create new one`
        );
        this.databaseId = null;
      } catch (error) {
        // Database was deleted, reset
        logger.warn(
          `Cached database ${this.databaseId} no longer exists, will create new one`
        );
        this.databaseId = null;
      }
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
      // Use conversation ID as the database entry name (not topic)
      const conversationId = conversation.id;

      // Find or create database entry for this conversation
      const entryId = await this.findOrCreateDatabaseEntry(
        conversationId,
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

      logger.info(
        `Updated Notion reasoning document for conversation: ${conversationId}`
      );
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
      // Use conversation ID as the database entry name (not topic)
      const conversationId = conversation.id;

      // Find or create database entry
      const entryId = await this.findOrCreateDatabaseEntry(
        conversationId,
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

      logger.info(`Updated Notion TLDR for conversation: ${conversationId}`);
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
   * Find or create a database entry for a conversation
   * Uses conversation ID as the entry name
   * Returns the page ID of the entry
   */
  private async findOrCreateDatabaseEntry(
    conversationId: string,
    _conversation: ConversationState
  ): Promise<string> {
    try {
      // Ensure database exists
      const databaseId = await this.ensureDatabase();

      // Search for existing entry with this conversation ID using search API
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
            // Check if the Name property matches
            const nameProperty = result.properties["Name"];
            if (
              nameProperty &&
              nameProperty.type === "title" &&
              "title" in nameProperty
            ) {
              const titleText = nameProperty.title[0]?.plain_text || "";
              if (titleText === conversationId) {
                return result.id;
              }
            }
          }
        }
      }

      // Create new entry with Name property
      const newPage = await this.client.pages.create({
        parent: {
          database_id: databaseId,
        },
        properties: {
          Name: {
            title: [
              {
                text: {
                  content: conversationId,
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
      // Use conversation ID as the database entry name (not topic)
      const conversationId = conversation.id;
      const entryId = await this.findOrCreateDatabaseEntry(
        conversationId,
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
   * Parse markdown content and convert to Notion blocks
   * Supports: headings, bold, italic, code blocks, lists, paragraphs
   *
   * @param markdown - Markdown content to parse
   * @returns Array of Notion block objects
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseMarkdownToNotionBlocks(markdown: string): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [];
    const lines = markdown.split("\n");
    let currentParagraph: string[] = [];
    let inCodeBlock = false;
    let codeBlockContent: string[] = [];
    let codeBlockLanguage = "";

    const flushParagraph = () => {
      if (currentParagraph.length > 0) {
        const text = currentParagraph.join("\n").trim();
        if (text) {
          const paragraphBlocks = this.createParagraphBlock(text);
          blocks.push(...paragraphBlocks);
        }
        currentParagraph = [];
      }
    };

    const flushCodeBlock = () => {
      if (codeBlockContent.length > 0) {
        const code = codeBlockContent.join("\n");
        blocks.push({
          object: "block",
          type: "code",
          code: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: code,
                },
              },
            ],
            language: codeBlockLanguage || "plain text",
          },
        });
        codeBlockContent = [];
        codeBlockLanguage = "";
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for code blocks
      if (line.startsWith("```")) {
        if (inCodeBlock) {
          flushCodeBlock();
          inCodeBlock = false;
        } else {
          flushParagraph();
          inCodeBlock = true;
          codeBlockLanguage = line.substring(3).trim() || "plain text";
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockContent.push(line);
        continue;
      }

      // Check for headings
      if (line.startsWith("### ")) {
        flushParagraph();
        blocks.push({
          object: "block",
          type: "heading_3",
          heading_3: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: line.substring(4).trim(),
                },
              },
            ],
          },
        });
        continue;
      }

      if (line.startsWith("## ")) {
        flushParagraph();
        blocks.push({
          object: "block",
          type: "heading_2",
          heading_2: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: line.substring(3).trim(),
                },
              },
            ],
          },
        });
        continue;
      }

      if (line.startsWith("# ")) {
        flushParagraph();
        blocks.push({
          object: "block",
          type: "heading_1",
          heading_1: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: line.substring(2).trim(),
                },
              },
            ],
          },
        });
        continue;
      }

      // Check for horizontal rule
      if (line.trim() === "---" || line.trim() === "***") {
        flushParagraph();
        blocks.push({
          object: "block",
          type: "divider",
          divider: {},
        });
        continue;
      }

      // Regular line - add to current paragraph
      if (line.trim() === "") {
        flushParagraph();
      } else {
        currentParagraph.push(line);
      }
    }

    flushParagraph();
    flushCodeBlock();

    return blocks;
  }

  /**
   * Create paragraph block(s) with rich text formatting (bold, italic)
   * Splits into multiple blocks if content exceeds 2000 characters
   *
   * @param text - Text content with markdown formatting
   * @returns Array of Notion paragraph blocks
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private createParagraphBlock(text: string): any[] {
    const MAX_TEXT_LENGTH = 2000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [];

    // If text is short enough, process normally
    if (text.length <= MAX_TEXT_LENGTH) {
      return [this.parseRichText(text)];
    }

    // Split long text into chunks, trying to break at word boundaries
    const chunks = this.splitContentIntoChunks(text, MAX_TEXT_LENGTH - 10);
    for (const chunk of chunks) {
      blocks.push(this.parseRichText(chunk));
    }

    return blocks;
  }

  /**
   * Parse text with markdown formatting into Notion rich text array
   *
   * @param text - Text content with markdown formatting
   * @returns Notion paragraph block
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseRichText(text: string): any {
    // Parse bold (**text**) and italic (*text*)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const richText: any[] = [];
    let currentIndex = 0;
    const textLength = text.length;

    while (currentIndex < textLength) {
      // Check for bold (**text**)
      const boldMatch = text.substring(currentIndex).match(/^\*\*(.+?)\*\*/);
      if (boldMatch) {
        richText.push({
          type: "text",
          text: {
            content: boldMatch[1],
          },
          annotations: {
            bold: true,
            italic: false,
          },
        });
        currentIndex += boldMatch[0].length;
        continue;
      }

      // Check for italic (*text*)
      const italicMatch = text.substring(currentIndex).match(/^\*(.+?)\*/);
      if (italicMatch) {
        richText.push({
          type: "text",
          text: {
            content: italicMatch[1],
          },
          annotations: {
            bold: false,
            italic: true,
          },
        });
        currentIndex += italicMatch[0].length;
        continue;
      }

      // Regular text - find next formatting or end
      let nextFormat = textLength;
      const nextBold = text.indexOf("**", currentIndex);
      const nextItalic = text.indexOf("*", currentIndex);
      if (nextBold !== -1 && nextBold < nextFormat) nextFormat = nextBold;
      if (nextItalic !== -1 && nextItalic < nextFormat) nextFormat = nextItalic;

      const plainText = text.substring(currentIndex, nextFormat);
      if (plainText) {
        richText.push({
          type: "text",
          text: {
            content: plainText,
          },
        });
      }
      currentIndex = nextFormat;
    }

    return {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text:
          richText.length > 0
            ? richText
            : [{ type: "text", text: { content: text } }],
      },
    };
  }

  /**
   * Split content into chunks that fit within Notion's 2000 character limit per paragraph
   * Notion API limit: 2000 characters per text content in a paragraph block
   *
   * @param content - The content to split
   * @param maxLength - Maximum length per chunk (default: 1990 for safety margin)
   * @returns Array of content chunks
   */
  private splitContentIntoChunks(
    content: string,
    maxLength: number = 1990
  ): string[] {
    if (content.length <= maxLength) {
      return [content];
    }

    const chunks: string[] = [];
    let currentIndex = 0;

    while (currentIndex < content.length) {
      let chunk = content.slice(currentIndex, currentIndex + maxLength);

      // Try to break at a newline if we're in the middle of the content
      if (currentIndex + maxLength < content.length) {
        const lastNewline = chunk.lastIndexOf("\n");
        if (lastNewline > maxLength * 0.8) {
          // If we found a newline in the last 20% of the chunk, use it
          chunk = chunk.slice(0, lastNewline + 1);
          currentIndex += lastNewline + 1;
        } else {
          currentIndex += maxLength;
        }
      } else {
        currentIndex += maxLength;
      }

      chunks.push(chunk);
    }

    return chunks;
  }

  /**
   * Append content to a Notion page, parsing markdown and creating proper blocks
   * Handles headings, bold, italic, code blocks, and paragraphs
   *
   * @param blockId - The Notion block/page ID to append to
   * @param content - The markdown content to append
   */
  private async appendContentToPage(
    blockId: string,
    content: string
  ): Promise<void> {
    // Parse markdown into Notion blocks
    const blocks = this.parseMarkdownToNotionBlocks(content);

    logger.info(
      `Appending content to page ${blockId} (${content.length} chars, parsed into ${blocks.length} blocks)`
    );

    if (blocks.length === 0) {
      return;
    }

    // Notion API allows appending up to 100 blocks at once
    const batchSize = 100;
    for (let i = 0; i < blocks.length; i += batchSize) {
      const batch = blocks.slice(i, i + batchSize);
      await retryWithBackoff(
        () =>
          this.client.blocks.children.append({
            block_id: blockId,
            children: batch,
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

      // Add new TLDR content (split into chunks if needed)
      await this.appendContentToPage(entryId, content);
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
        // Update existing subpage (split into chunks if needed)
        await this.appendContentToPage(subpageId, content);
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

        // Add content to subpage (split into chunks if needed)
        await this.appendContentToPage(subpage.id, content);
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
            // Check if the Name property contains the conversation ID
            const nameProperty = result.properties["Name"];
            if (
              nameProperty &&
              nameProperty.type === "title" &&
              "title" in nameProperty
            ) {
              const titleText = nameProperty.title[0]?.plain_text || "";
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
