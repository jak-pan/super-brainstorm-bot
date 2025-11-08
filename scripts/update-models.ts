#!/usr/bin/env tsx

/**
 * Script to update models.json with latest model information and pricing
 * Dynamically fetches models from provider APIs and updates pricing from official sources
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { URL } from "url";
import https from "https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MODELS_FILE = join(__dirname, "../src/config/models.json");
const FALLBACK_MODELS_FILE = join(__dirname, "fallback-models.json");
const PRICING_FILE = join(__dirname, "fallback-pricing.json");
const CONTEXT_WINDOWS_FILE = join(__dirname, "context-windows.json");

// Load fallback models, pricing, and context windows from JSON files
let fallbackModels: {
  openai: Array<{ id: string; name: string }>;
  anthropic: Array<{ id: string; name: string }>;
  grok: Array<{ id: string; name: string }>;
} | null = null;
let pricingData: {
  openai: Record<string, { input: number; output: number }>;
  anthropic: Record<string, { input: number; output: number }>;
  grok: Record<string, { input: number; output: number }>;
} | null = null;
let contextWindows: {
  openai: Record<string, number>;
  anthropic: Record<string, number>;
  grok: Record<string, number>;
} | null = null;

function loadFallbackModels() {
  if (!fallbackModels) {
    try {
      fallbackModels = JSON.parse(readFileSync(FALLBACK_MODELS_FILE, "utf-8"));
    } catch (error) {
      console.error("❌ Failed to load fallback-models.json:", error);
      process.exit(1);
    }
  }
  return fallbackModels;
}

function loadPricingData() {
  if (!pricingData) {
    try {
      pricingData = JSON.parse(readFileSync(PRICING_FILE, "utf-8"));
    } catch (error) {
      console.error("❌ Failed to load fallback-pricing.json:", error);
      process.exit(1);
    }
  }
  return pricingData;
}

function loadContextWindows() {
  if (!contextWindows) {
    try {
      contextWindows = JSON.parse(readFileSync(CONTEXT_WINDOWS_FILE, "utf-8"));
    } catch (error) {
      console.error("❌ Failed to load context-windows.json:", error);
      process.exit(1);
    }
  }
  return contextWindows;
}

/**
 * Get highest pricing as fallback
 */
function getHighestPricing(provider: "openai" | "anthropic" | "grok"): {
  input: number;
  output: number;
} {
  const pricingData = loadPricingData();
  if (!pricingData) {
    // Default fallback
    return provider === "grok"
      ? { input: 0.001, output: 0.001 }
      : { input: 0.003, output: 0.015 };
  }
  const pricing = pricingData[provider];
  if (!pricing) {
    // Default fallback
    return provider === "grok"
      ? { input: 0.001, output: 0.001 }
      : { input: 0.003, output: 0.015 };
  }
  const prices = Object.values(pricing);
  if (prices.length === 0) {
    // Default fallback
    return provider === "grok"
      ? { input: 0.001, output: 0.001 }
      : { input: 0.003, output: 0.015 };
  }

  // Find highest input and output prices
  const highestInput = Math.max(...prices.map((p) => p.input));
  const highestOutput = Math.max(...prices.map((p) => p.output));

  return { input: highestInput, output: highestOutput };
}

/**
 * Fetch available models from OpenAI API using official SDK
 */
async function fetchOpenAIModels(apiKey?: string) {
  if (!apiKey) {
    console.log(
      "ℹ️  OPENAI_API_KEY not set, using known OpenAI models as fallback"
    );
    const fallback = loadFallbackModels();
    if (!fallback) {
      throw new Error("Failed to load fallback models");
    }
    return fallback.openai;
  }

  try {
    console.log("📡 Fetching models from OpenAI API...");
    const openai = new OpenAI({ apiKey });

    const response = await openai.models.list();
    const models = response.data || [];

    const chatModels = models
      .filter((m) => {
        const id = m.id.toLowerCase();
        return (
          id.startsWith("gpt-") || id.startsWith("o") || id.includes("chat")
        );
      })
      .map((m) => ({
        id: m.id,
        name: m.id,
        created: m.created,
        owned_by: m.owned_by,
      }));

    if (chatModels.length > 0) {
      console.log(`✅ Found ${chatModels.length} OpenAI chat models`);
      return chatModels;
    }

    console.log(
      "⚠️  No models from API, using known current models as fallback"
    );
    const fallback = loadFallbackModels();
    if (!fallback) {
      throw new Error("Failed to load fallback models");
    }
    return fallback.openai;
  } catch (error) {
    console.warn(
      `⚠️  Could not fetch OpenAI models: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    console.warn("   Using known current models as fallback");
    const fallback = loadFallbackModels();
    if (!fallback) {
      throw new Error("Failed to load fallback models");
    }
    return fallback.openai;
  }
}

/**
 * Get OpenAI pricing - loaded from fallback-pricing.json
 * Uses highest price as fallback if model not found
 */
function getOpenAIPricing(modelId: string): { input: number; output: number } {
  const id = modelId.toLowerCase();
  const pricingData = loadPricingData();
  if (!pricingData) {
    return getHighestPricing("openai");
  }
  const pricing = pricingData.openai;

  // Try exact match first
  if (pricing && pricing[id]) {
    return pricing[id];
  }

  // Use highest price as fallback
  return getHighestPricing("openai");
}

/**
 * Fetch available models from Anthropic API using official SDK
 */
async function fetchAnthropicModels(apiKey?: string) {
  if (!apiKey) {
    console.log(
      "ℹ️  ANTHROPIC_API_KEY not set, using known Anthropic models as fallback"
    );
    const fallback = loadFallbackModels();
    if (!fallback) {
      throw new Error("Failed to load fallback models");
    }
    return fallback.anthropic;
  }

  try {
    console.log("📡 Fetching models from Anthropic API...");
    // Use Anthropic SDK (https://docs.claude.com/en/api/client-sdks)
    // Reference: https://docs.claude.com/en/api/models-list
    const anthropic = new Anthropic({ apiKey });

    // Try using SDK's models.list() method if available
    try {
      const response = await anthropic.models.list();
      const models = response.data || [];

      const claudeModels = models
        .filter((m) => m.type === "model" && m.id && m.id.startsWith("claude-"))
        .map((m) => ({
          id: m.id,
          name: m.display_name || m.id,
          created_at: m.created_at,
        }));

      if (claudeModels.length > 0) {
        console.log(`✅ Found ${claudeModels.length} Anthropic models`);
        return claudeModels;
      }
    } catch (sdkError) {
      // Fallback to fetch() if SDK method doesn't exist or fails
      console.warn(
        "⚠️  SDK models.list() not available, using fetch() fallback"
      );
      const response = await fetch("https://api.anthropic.com/v1/models", {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        data?: Array<{
          id: string;
          display_name?: string;
          type?: string;
          created_at?: string;
        }>;
      };
      const models = data.data || [];

      const claudeModels = models
        .filter((m) => m.type === "model" && m.id && m.id.startsWith("claude-"))
        .map((m) => ({
          id: m.id,
          name: m.display_name || m.id,
          created_at: m.created_at,
        }));

      if (claudeModels.length > 0) {
        console.log(`✅ Found ${claudeModels.length} Anthropic models`);
        return claudeModels;
      }
    }

    console.warn("⚠️  No models from API, using known models as fallback");
    const fallback = loadFallbackModels();
    if (!fallback) {
      throw new Error("Failed to load fallback models");
    }
    return fallback.anthropic;
  } catch (error) {
    console.warn(
      `⚠️  Could not fetch Anthropic models: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    console.warn("   Using known models as fallback");
    const fallback = loadFallbackModels();
    if (!fallback) {
      throw new Error("Failed to load fallback models");
    }
    return fallback.anthropic;
  }
}

/**
 * Scrape Anthropic pricing from their pricing page
 * Since pricing is not available via API, we scrape from https://www.anthropic.com/pricing
 * Returns raw HTML string for parsing
 */
async function scrapeAnthropicPricingHTML(
  url = "https://www.anthropic.com/pricing",
  maxRedirects = 5
): Promise<string | null> {
  if (maxRedirects <= 0) {
    throw new Error("Too many redirects");
  }

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ModelUpdater/1.0)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    };

    const req = https.request(options, (res) => {
      // Handle redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
        const location = res.headers.location;
        if (location) {
          // Resolve relative URLs
          const redirectUrl = location.startsWith("http")
            ? location
            : `${urlObj.protocol}//${urlObj.hostname}${location}`;
          // Follow redirect recursively
          return scrapeAnthropicPricingHTML(redirectUrl, maxRedirects - 1)
            .then(resolve)
            .catch(reject);
        }
      }

      let data = "";
      res.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode || "unknown"}`));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.end();
  });
}

/**
 * Parse pricing from Anthropic pricing page HTML
 * This is a basic implementation - may need refinement based on actual page structure
 */
function parseAnthropicPricingFromHTML(
  html: string | null
): Record<string, { input: number; output: number }> | null {
  if (!html) return null;

  try {
    // TODO: Implement actual HTML parsing logic here
    // For now, return null to use fallback-pricing.json
    console.warn(
      "⚠️  HTML parsing not fully implemented, using fallback-pricing.json"
    );
    return null;
  } catch (error) {
    console.warn(
      `⚠️  Error parsing pricing HTML: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

/**
 * Update Anthropic pricing from scraped data
 */
async function updateAnthropicPricing(): Promise<void> {
  try {
    const html = await scrapeAnthropicPricingHTML();
    if (!html) {
      console.log("ℹ️  Using fallback-pricing.json for Anthropic pricing");
      return;
    }

    const scrapedPricing = parseAnthropicPricingFromHTML(html);
    if (scrapedPricing) {
      // Update fallback-pricing.json with scraped data
      const pricing = loadPricingData();
      if (pricing && pricing.anthropic) {
        pricing.anthropic = { ...pricing.anthropic, ...scrapedPricing };
        writeFileSync(
          PRICING_FILE,
          JSON.stringify(pricing, null, 2) + "\n",
          "utf-8"
        );
        console.log("✅ Updated Anthropic pricing from scraped data");
      }
    } else {
      console.log(
        "ℹ️  Using fallback-pricing.json for Anthropic pricing (scraping not fully implemented)"
      );
    }
  } catch (error) {
    // Silently fail - use pricing.json as fallback
    // Pricing scraping is optional and pricing.json is the source of truth
  }
}

/**
 * Get Anthropic pricing - loaded from fallback-pricing.json (or scraped if available)
 * Uses highest price as fallback if model not found
 */
function getAnthropicPricing(modelId: string): {
  input: number;
  output: number;
} {
  const id = modelId.toLowerCase();
  const pricingData = loadPricingData();
  if (!pricingData) {
    return getHighestPricing("anthropic");
  }
  const pricing = pricingData.anthropic;

  // Try exact match
  if (pricing && pricing[id]) {
    return pricing[id];
  }

  // Use highest price as fallback
  return getHighestPricing("anthropic");
}

/**
 * Fetch available models from Grok API
 * Uses @ai-sdk/xai SDK (https://ai-sdk.dev/providers/ai-sdk-providers/xai)
 * Falls back to OpenAI SDK if xAI SDK doesn't support model listing
 */
async function fetchGrokModels(apiKey?: string) {
  if (!apiKey) {
    console.log(
      "ℹ️  GROK_API_KEY not set, using known Grok models as fallback"
    );
    const fallback = loadFallbackModels();
    if (!fallback) {
      throw new Error("Failed to load fallback models");
    }
    return fallback.grok;
  }

  try {
    console.log("📡 Fetching models from Grok API...");
    // Try using @ai-sdk/xai SDK first
    // Reference: https://ai-sdk.dev/providers/ai-sdk-providers/xai
    // xAI SDK uses OpenAI-compatible API, so we can use OpenAI SDK for model listing
    // The @ai-sdk/xai is primarily for text generation, not model listing
    const grok = new OpenAI({
      apiKey,
      baseURL: "https://api.x.ai/v1",
    });

    const response = await grok.models.list();
    const models = response.data || [];

    const grokModels = models
      .filter((m) => m.id.includes("grok"))
      .map((m) => ({
        id: m.id,
        name: m.id,
      }));

    if (grokModels.length > 0) {
      console.log(`✅ Found ${grokModels.length} Grok models`);
      return grokModels;
    }

    const fallback = loadFallbackModels();
    if (!fallback) {
      throw new Error("Failed to load fallback models");
    }
    return fallback.grok;
  } catch (error) {
    console.warn(
      `⚠️  Could not fetch Grok models: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    const fallback = loadFallbackModels();
    if (!fallback) {
      throw new Error("Failed to load fallback models");
    }
    return fallback.grok;
  }
}

/**
 * Get Grok pricing - loaded from fallback-pricing.json
 * Uses highest price as fallback if model not found
 */
function getGrokPricing(modelId: string): { input: number; output: number } {
  const pricingData = loadPricingData();
  if (!pricingData) {
    return getHighestPricing("grok");
  }
  const pricing = pricingData.grok;
  if (pricing && pricing[modelId]) {
    return pricing[modelId];
  }
  // Use highest price as fallback
  return getHighestPricing("grok");
}

/**
 * Get context window for a model
 * First tries to fetch from API, then falls back to context-windows.json
 */
function getContextWindow(
  provider: "openai" | "anthropic" | "grok",
  modelId: string
): number {
  const id = modelId.toLowerCase();
  const contextWindowsData = loadContextWindows();

  // Try exact match first
  if (contextWindowsData && contextWindowsData[provider]?.[id]) {
    return contextWindowsData[provider][id];
  }

  // Default fallbacks based on provider
  if (provider === "openai") {
    // Most OpenAI models have 128k, older ones have smaller windows
    return 128000;
  }

  if (provider === "anthropic") {
    // All Claude 3+ and 4+ models have 200k
    return 200000;
  }

  if (provider === "grok") {
    // Grok-2 has larger context, others have 8k
    return id.includes("grok-2") ? 131072 : 8192;
  }

  return 128000; // Default
}

/**
 * Determine if a model is the "smartest" for its provider
 */
function isSmartestModel(
  provider: "openai" | "anthropic" | "grok",
  modelId: string
): boolean {
  const id = modelId.toLowerCase();

  if (provider === "openai") {
    // GPT-5 Pro is the smartest, then GPT-5, then GPT-4o
    if (id.includes("gpt-5-pro")) return true;
    if (id.includes("gpt-5") && !id.includes("mini") && !id.includes("nano"))
      return true;
    if (id.includes("gpt-4o") && !id.includes("mini")) return true;
    return false;
  }
  if (provider === "anthropic") {
    // Claude Sonnet 4 (2025) is smartest, then Opus 4.1, then Sonnet 4.5, then 3.5 Sonnet
    if (
      id.includes("sonnet") &&
      id.includes("4") &&
      (id.includes("2025") || id.includes("50514"))
    )
      return true;
    if (id.includes("opus") && (id.includes("4") || id.includes("4.1")))
      return true;
    if (id.includes("sonnet") && (id.includes("4") || id.includes("4.5")))
      return true;
    if (id.includes("claude-3-5-sonnet")) return true;
    return false;
  }
  if (provider === "grok") {
    // Grok-2 is typically the smartest
    return id === "grok-2" || id.includes("grok-2");
  }
  return false;
}

/**
 * Update models.json with latest information
 */
async function updateModels(): Promise<void> {
  console.log("🔄 Dynamically fetching and updating models.json...\n");

  try {
    // Try to update Anthropic pricing from web scraping
    await updateAnthropicPricing();

    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const grokKey = process.env.GROK_API_KEY;

    // Fetch models from APIs
    const openaiModels = await fetchOpenAIModels(openaiKey);
    const anthropicModels = await fetchAnthropicModels(anthropicKey);
    const grokModels = await fetchGrokModels(grokKey);

    // Build new models structure
    const newModels: {
      openai: {
        provider: string;
        models: Array<{
          id: string;
          name: string;
          description: string;
          contextWindow: number;
          pricing: { input: number; output: number; unit: string };
          smartest: boolean;
          available: boolean;
        }>;
        defaultModel: string | null;
        smartestModel: string | null;
      };
      anthropic: {
        provider: string;
        models: Array<{
          id: string;
          name: string;
          description: string;
          contextWindow: number;
          pricing: { input: number; output: number; unit: string };
          smartest: boolean;
          available: boolean;
        }>;
        defaultModel: string | null;
        smartestModel: string | null;
      };
      grok: {
        provider: string;
        models: Array<{
          id: string;
          name: string;
          description: string;
          contextWindow: number;
          pricing: { input: number; output: number; unit: string };
          smartest: boolean;
          available: boolean;
        }>;
        defaultModel: string | null;
        smartestModel: string | null;
      };
    } = {
      openai: {
        provider: "OpenAI",
        models: [],
        defaultModel: null,
        smartestModel: null,
      },
      anthropic: {
        provider: "Anthropic",
        models: [],
        defaultModel: null,
        smartestModel: null,
      },
      grok: {
        provider: "X.AI",
        models: [],
        defaultModel: null,
        smartestModel: null,
      },
    };

    // Process OpenAI models
    if (openaiModels && openaiModels.length > 0) {
      let smartestModelId: string | null = null;

      // First pass: find the smartest model
      for (const model of openaiModels) {
        if (isSmartestModel("openai", model.id)) {
          smartestModelId = model.id;
          break; // Only one smartest model
        }
      }

      // Second pass: build models array
      openaiModels.forEach((model) => {
        const pricing = getOpenAIPricing(model.id);
        const contextWindow = getContextWindow("openai", model.id);
        const isSmartest = model.id === smartestModelId;

        newModels.openai.models.push({
          id: model.id,
          name: model.id
            .replace(/-/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase()),
          description: `OpenAI ${model.id} model`,
          contextWindow,
          pricing: {
            input: pricing.input,
            output: pricing.output,
            unit: "per_1k_tokens",
          },
          smartest: isSmartest,
          available: !!openaiKey || true, // Available if we have key or using fallback
        });
      });

      // Set default and smartest
      newModels.openai.smartestModel =
        smartestModelId || newModels.openai.models[0]?.id || null;
      newModels.openai.defaultModel = newModels.openai.models[0]?.id || null;
    }

    // Process Anthropic models
    if (anthropicModels && anthropicModels.length > 0) {
      let smartestModelId: string | null = null;

      // First pass: find the smartest model
      for (const model of anthropicModels) {
        if (isSmartestModel("anthropic", model.id)) {
          smartestModelId = model.id;
          break; // Only one smartest model
        }
      }

      // Second pass: build models array
      anthropicModels.forEach((model) => {
        const pricing = getAnthropicPricing(model.id);
        const contextWindow = getContextWindow("anthropic", model.id);
        const isSmartest = model.id === smartestModelId;

        newModels.anthropic.models.push({
          id: model.id,
          name: model.id
            .replace(/-/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase()),
          description: `Anthropic ${model.id} model`,
          contextWindow,
          pricing: {
            input: pricing.input,
            output: pricing.output,
            unit: "per_1k_tokens",
          },
          smartest: isSmartest,
          available: !!anthropicKey,
        });
      });

      newModels.anthropic.smartestModel =
        smartestModelId || newModels.anthropic.models[0]?.id || null;
      newModels.anthropic.defaultModel =
        newModels.anthropic.models[0]?.id || null;
    }

    // Process Grok models
    if (grokModels && grokModels.length > 0) {
      let smartestModelId: string | null = null;

      // First pass: find the smartest model
      for (const model of grokModels) {
        if (isSmartestModel("grok", model.id)) {
          smartestModelId = model.id;
          break; // Only one smartest model
        }
      }

      // Second pass: build models array
      grokModels.forEach((model) => {
        const pricing = getGrokPricing(model.id);
        const contextWindow = getContextWindow("grok", model.id);
        const isSmartest = model.id === smartestModelId;

        newModels.grok.models.push({
          id: model.id,
          name: model.id
            .replace(/-/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase()),
          description: `X.AI ${model.id} model`,
          contextWindow,
          pricing: {
            input: pricing.input,
            output: pricing.output,
            unit: "per_1k_tokens",
          },
          smartest: isSmartest,
          available: !!grokKey,
        });
      });

      newModels.grok.smartestModel =
        smartestModelId || newModels.grok.models[0]?.id || null;
      newModels.grok.defaultModel = newModels.grok.models[0]?.id || null;
    }

    // Write updated models.json
    writeFileSync(
      MODELS_FILE,
      JSON.stringify(newModels, null, 2) + "\n",
      "utf-8"
    );

    console.log("\n✅ models.json updated successfully!");
    console.log(`   OpenAI: ${newModels.openai.models.length} models`);
    console.log(`   Anthropic: ${newModels.anthropic.models.length} models`);
    console.log(`   Grok: ${newModels.grok.models.length} models`);
    console.log(
      "\n📝 Note: Pricing is estimated based on known pricing structures."
    );
    console.log(
      "   To update pricing, check official pricing pages and update"
    );
    console.log(
      "   getOpenAIPricing(), getAnthropicPricing(), or getGrokPricing() functions:"
    );
    console.log("   - OpenAI: https://openai.com/api/pricing/");
    console.log("   - Anthropic: https://www.anthropic.com/pricing");
    console.log("   - Grok: https://x.ai/pricing\n");
  } catch (error) {
    console.error(
      "❌ Error updating models.json:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateModels();
}

export { updateModels };
