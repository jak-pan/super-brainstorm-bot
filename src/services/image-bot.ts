import type { Config } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { getImageModels } from "./model-selector.js";

/**
 * Image Generation Bot
 *
 * Generates images based on text prompts from TLDR summaries or linked messages.
 * Uses multiple image generation models in parallel for diverse outputs.
 */
export class ImageBot {
  private config: Config;
  private defaultImageModels: string[];

  constructor(config: Config) {
    this.config = config;
    this.defaultImageModels = getImageModels();
  }

  /**
   * Generate images from a text prompt
   *
   * @param prompt - Text prompt for image generation
   * @param modelIds - Optional array of model IDs to use (defaults to defaultImageModels)
   * @returns Array of generated image URLs
   */
  async generateImages(
    prompt: string,
    modelIds?: string[]
  ): Promise<
    Array<{ modelId: string; imageUrl: string; cost?: number; error?: string }>
  > {
    const modelsToUse = modelIds || this.defaultImageModels;
    const results: Array<{
      modelId: string;
      imageUrl: string;
      cost?: number;
      error?: string;
    }> = [];

    // Generate images in parallel
    const promises = modelsToUse.map(async (modelId) => {
      try {
        const result = await this.generateImageWithModel(prompt, modelId);
        return { modelId, imageUrl: result.url, cost: result.cost };
      } catch (error) {
        logger.error(`Failed to generate image with ${modelId}:`, error);
        return {
          modelId,
          imageUrl: "",
          cost: 0,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    });

    const imageResults = await Promise.all(promises);
    results.push(...imageResults);

    return results.filter((r) => r.imageUrl || r.error);
  }

  /**
   * Generate a single image using a specific model
   *
   * @param prompt - Text prompt for image generation
   * @param modelId - OpenRouter model ID for image generation
   * @returns URL and cost of generated image
   */
  private async generateImageWithModel(
    prompt: string,
    modelId: string
  ): Promise<{ url: string; cost: number }> {
    try {
      // Use OpenRouter's API for image generation
      // For image models (gpt-5-image, gemini-2.5-flash-image, dall-e), we use the images endpoint
      const isImageModel =
        modelId.includes("image") || modelId.includes("dall-e");

      if (isImageModel) {
        // For DALL-E models, use OpenAI-compatible image generation endpoint via OpenRouter
        const response = await fetch(
          "https://openrouter.ai/api/v1/images/generations",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.config.openrouter.apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://github.com/jak-pan/super-brainstorm-bot",
              "X-Title": "Super Brainstorm Bot",
            },
            body: JSON.stringify({
              model: modelId,
              prompt: prompt,
              size: "1024x1024",
              quality: "standard",
              n: 1,
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `OpenRouter API error: ${response.status} - ${errorText}`
          );
        }

        const data = (await response.json()) as {
          data?: Array<{ url?: string; b64_json?: string }>;
          usage?: { total_cost?: number };
        };

        // Get cost directly from OpenRouter API response (in USD)
        // OpenRouter API provides total_cost in the usage object - no manual calculation needed
        // See: https://openrouter.ai/docs/api-reference/models/get-models
        const actualCost = data.usage?.total_cost || 0;

        if (data.data && data.data.length > 0) {
          const imageData = data.data[0];
          if (imageData.url) {
            return { url: imageData.url, cost: actualCost };
          }
          if (imageData.b64_json) {
            return {
              url: `data:image/png;base64,${imageData.b64_json}`,
              cost: actualCost,
            };
          }
        }
      } else {
        // For other models, try using chat completions with image generation capability
        const response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.config.openrouter.apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://github.com/jak-pan/super-brainstorm-bot",
              "X-Title": "Super Brainstorm Bot",
            },
            body: JSON.stringify({
              model: modelId,
              messages: [
                {
                  role: "user",
                  content: `Generate an image based on: ${prompt}`,
                },
              ],
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `OpenRouter API error: ${response.status} - ${errorText}`
          );
        }

        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { total_cost?: number };
        };

        // Get cost directly from OpenRouter API response (in USD)
        // OpenRouter API provides total_cost in the usage object - no manual calculation needed
        const actualCost = data.usage?.total_cost || 0;

        // Extract image URL from response
        if (data.choices && data.choices.length > 0) {
          const content = data.choices[0].message?.content;
          if (content) {
            // Try to extract URL from content
            const urlMatch = content.match(/https?:\/\/[^\s]+/);
            if (urlMatch) {
              return { url: urlMatch[0], cost: actualCost };
            }
          }
        }
      }

      throw new Error("No image data returned from model");
    } catch (error) {
      logger.error(`Error generating image with ${modelId}:`, error);
      throw error;
    }
  }

  /**
   * Extract prompt from TLDR summary or message content
   *
   * @param content - Text content to extract prompt from
   * @returns Extracted prompt for image generation
   */
  extractPromptFromContent(content: string): string {
    // If content is already a clear prompt, use it directly
    if (content.length < 500 && !content.includes("\n\n")) {
      return content.trim();
    }

    // For longer content (like TLDR summaries), extract key visual elements
    // This is a simple extraction - could be enhanced with AI
    const lines = content.split("\n");
    const keyLines = lines
      .filter((line) => {
        const lower = line.toLowerCase();
        return (
          lower.includes("visual") ||
          lower.includes("image") ||
          lower.includes("diagram") ||
          lower.includes("chart") ||
          lower.includes("graph") ||
          lower.includes("design") ||
          lower.includes("appearance") ||
          lower.includes("look") ||
          lower.includes("style")
        );
      })
      .slice(0, 3);

    if (keyLines.length > 0) {
      return keyLines.join(" ").trim();
    }

    // Fallback: use first sentence or first 200 characters
    const firstSentence = content.split(/[.!?]/)[0];
    if (firstSentence.length > 20 && firstSentence.length < 200) {
      return firstSentence.trim();
    }

    return content.substring(0, 200).trim() + "...";
  }
}
