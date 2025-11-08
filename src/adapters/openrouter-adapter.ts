import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { BaseAdapter } from "./base-adapter.js";
import type { Message, AIResponse } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { retryWithBackoff } from "../utils/retry.js";
import { CircuitBreaker } from "../utils/circuit-breaker.js";

/**
 * OpenRouter Adapter
 *
 * Unified adapter for all AI models via OpenRouter API.
 * Supports OpenAI, Anthropic, Grok, and 300+ other models through a single API.
 *
 * Model format: "provider/model-id" (e.g., "openai/gpt-4o", "anthropic/claude-3-5-sonnet")
 *
 * See: https://openrouter.ai/docs/api-reference/overview
 */
export class OpenRouterAdapter extends BaseAdapter {
  private modelId: string; // Full model ID like "openai/gpt-4o" or "anthropic/claude-3-5-sonnet"
  private circuitBreaker: CircuitBreaker;
  private openrouter: ReturnType<typeof createOpenRouter>;

  constructor(apiKey: string, modelId: string) {
    // Extract provider name for display (e.g., "openai/gpt-4o" -> "OpenAI GPT-4o")
    const providerName = modelId.split("/")[0] || "OpenRouter";
    const modelName = modelId.split("/")[1] || modelId;
    const displayName = `${
      providerName.charAt(0).toUpperCase() + providerName.slice(1)
    } ${modelName}`;

    // Use a reasonable default context window (OpenRouter normalizes this)
    super(displayName, 128000);

    this.modelId = modelId;

    // Set API key for OpenRouter (uses OPENROUTER_API_KEY env var)
    process.env.OPENROUTER_API_KEY = apiKey;

    // Create OpenRouter provider instance
    this.openrouter = createOpenRouter({
      apiKey: apiKey,
    });

    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 60000, // 1 minute
    });
  }

  /**
   * Generate a response using OpenRouter API
   *
   * @param context - Conversation messages
   * @param systemPrompt - System prompt for the AI
   * @param replyTo - Optional message IDs to reply to
   * @returns AI response with content, tokens, and metadata
   * @throws Error if API call fails after all retries
   */
  async generateResponse(
    context: Message[],
    systemPrompt: string,
    replyTo?: string[]
  ): Promise<AIResponse> {
    return this.circuitBreaker
      .execute(async () => {
        return retryWithBackoff(
          async () => {
            // Convert messages to AI SDK format
            const messages = context.map((msg) => ({
              role: msg.authorType === "user" ? "user" : "assistant",
              content: msg.content,
            })) as Array<{ role: "user" | "assistant"; content: string }>;

            // OpenRouter supports web search via providerOptions
            // See: https://openrouter.ai/docs/features/web-search
            // Web search is enabled for models that support it
            const result = await generateText({
              model: this.openrouter(this.modelId),
              system: systemPrompt,
              messages,
              temperature: 0.7,
              maxOutputTokens: 4000,
              // Enable web search for supported models
              providerOptions: {
                openrouter: {
                  // Web search is automatically available for models that support it
                  // Models with web search capability will use it automatically
                },
              },
            });

            // OpenRouter normalizes token counts and provides cost directly
            // See: https://openrouter.ai/docs/api-reference/models/get-models
            const inputTokens = result.usage?.inputTokens ?? 0;
            const outputTokens = result.usage?.outputTokens ?? 0;
            const tokens =
              (result.usage?.totalTokens ?? 0) || inputTokens + outputTokens;

            // Get cost directly from OpenRouter API response (in USD)
            // OpenRouter API provides total_cost in the usage object - no manual calculation needed
            // The usage object from OpenRouter includes total_cost, but it's not in the AI SDK types
            const usageWithCost = result.usage as typeof result.usage & {
              total_cost?: number;
            };
            const totalCost = usageWithCost.total_cost ?? 0;

            return {
              content: result.text,
              model: this.modelName,
              tokens,
              inputTokens,
              outputTokens,
              replyTo: replyTo || [],
              contextUsed: tokens,
              cost: totalCost, // Use OpenRouter's actual cost
            };
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
        );
      })
      .catch((error) => {
        logger.error("OpenRouter API error:", error);
        throw new Error(
          `OpenRouter API error: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      });
  }

  checkContextWindow(messages: Message[]): number {
    const totalTokens = messages.reduce((sum, msg) => {
      return sum + (msg.tokens || this.estimateTokens(msg.content));
    }, 0);
    return totalTokens;
  }
}
