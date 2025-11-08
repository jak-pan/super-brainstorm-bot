#!/usr/bin/env node

/**
 * Script to update models.json with latest model information and pricing
 * Dynamically fetches models from provider APIs and updates pricing from official sources
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import https from "https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MODELS_FILE = join(__dirname, "../src/config/models.json");
const FALLBACK_MODELS_FILE = join(__dirname, "fallback-models.json");
const PRICING_FILE = join(__dirname, "pricing.json");

// Load fallback models and pricing from JSON files
let fallbackModels = null;
let pricingData = null;

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
      console.error("❌ Failed to load pricing.json:", error);
      process.exit(1);
    }
  }
  return pricingData;
}

/**
 * Make HTTPS request
 */
function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || "GET",
      headers: options.headers || {},
    };

    const req = https.request(requestOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) {
            reject(
              new Error(`HTTP ${res.statusCode}: ${data.substring(0, 100)}`)
            );
            return;
          }
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
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
 * Fetch available models from OpenAI API
 */
async function fetchOpenAIModels(apiKey) {
  try {
    const headers = {};
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    console.log("📡 Fetching models from OpenAI API...");
    const response = await httpsRequest("https://api.openai.com/v1/models", {
      method: "GET",
      headers,
    });

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

    // Fallback to known current models if API doesn't return any
    console.log(
      "⚠️  No models from API, using known current models as fallback"
    );
    return loadFallbackModels().openai;
  } catch (error) {
    console.warn(`⚠️  Could not fetch OpenAI models: ${error.message}`);
    console.warn("   Using known current models as fallback");
    return loadFallbackModels().openai;
  }
}

/**
 * Get OpenAI pricing - loaded from pricing.json
 * Prices are per 1k tokens (converted from per 1M tokens)
 */
function getOpenAIPricing(modelId) {
  const id = modelId.toLowerCase();
  const pricing = loadPricingData().openai;

  // Try exact match first
  if (pricing[id]) {
    return pricing[id];
  }

  // Pattern matching for variants
  if (id.includes("gpt-5-pro")) return pricing["gpt-5-pro"] || { input: 0.002, output: 0.008 };
  if (id.includes("gpt-5") && id.includes("mini"))
    return pricing["gpt-5-mini"] || { input: 0.002, output: 0.008 };
  if (id.includes("gpt-5") && id.includes("nano"))
    return pricing["gpt-5-nano"] || { input: 0.002, output: 0.008 };
  if (id.includes("gpt-5")) return pricing["gpt-5"] || { input: 0.002, output: 0.008 };
  if (id.includes("gpt-4o") && id.includes("mini"))
    return pricing["gpt-4o-mini"] || { input: 0.002, output: 0.008 };
  if (id.includes("gpt-4o")) return pricing["gpt-4o"] || { input: 0.002, output: 0.008 };
  if (id.includes("gpt-4-turbo")) return pricing["gpt-4-turbo"] || { input: 0.002, output: 0.008 };
  if (id.includes("gpt-4") && !id.includes("turbo") && !id.includes("o"))
    return pricing["gpt-4"] || { input: 0.002, output: 0.008 };
  if (id.includes("gpt-3.5")) return pricing["gpt-3.5-turbo"] || { input: 0.002, output: 0.008 };

  // Default fallback pricing
  return { input: 0.002, output: 0.008 };
}

/**
 * Fetch available models from Anthropic API
 * Uses the official /v1/models endpoint
 * Reference: https://docs.claude.com/en/api/models-list
 */
async function fetchAnthropicModels(apiKey) {
  if (!apiKey) {
    console.log(
      "ℹ️  ANTHROPIC_API_KEY not set, using known Anthropic models as fallback"
    );
    return loadFallbackModels().anthropic;
  }

  try {
    console.log("📡 Fetching models from Anthropic API...");
    const response = await httpsRequest("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });

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

    // Fallback to known models if API doesn't return any
    console.warn("⚠️  No models from API, using known models as fallback");
    return loadFallbackModels().anthropic;
  } catch (error) {
    console.warn(`⚠️  Could not fetch Anthropic models: ${error.message}`);
    console.warn("   Using known models as fallback");
    return loadFallbackModels().anthropic;
  }
}

/**
 * Scrape Anthropic pricing from their pricing page
 * Since pricing is not available via API, we scrape from https://www.anthropic.com/pricing
 * Returns raw HTML string for parsing
 */
async function scrapeAnthropicPricingHTML() {
  try {
    console.log("📡 Attempting to scrape Anthropic pricing page...");
    return new Promise((resolve, reject) => {
      const url = new URL("https://www.anthropic.com/pricing");
      const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ModelUpdater/1.0)",
        },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
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
  } catch (error) {
    console.warn(`⚠️  Could not scrape Anthropic pricing: ${error.message}`);
    return null;
  }
}

/**
 * Parse pricing from Anthropic pricing page HTML
 * This is a basic implementation - may need refinement based on actual page structure
 */
function parseAnthropicPricingFromHTML(html) {
  if (!html) return null;

  try {
    // Extract pricing information from HTML
    // This is a simplified parser - actual implementation would need to handle
    // the specific HTML structure of Anthropic's pricing page
    
    // Look for pricing patterns in the HTML
    // Example patterns to look for:
    // - "$X.XX per million input tokens"
    // - "$X.XX per million output tokens"
    // - Model names and their associated prices
    
    const pricing = {};
    
    // Regex patterns to extract pricing (adjust based on actual page structure)
    const modelPatterns = [
      { name: "claude-sonnet-4", patterns: [/sonnet\s*4[^\$]*\$([\d.]+)/gi, /sonnet\s*4[^\$]*\$([\d.]+)/gi] },
      { name: "claude-opus-4.1", patterns: [/opus\s*4[^\$]*\$([\d.]+)/gi, /opus\s*4[^\$]*\$([\d.]+)/gi] },
      { name: "claude-haiku-4.5", patterns: [/haiku\s*4[^\$]*\$([\d.]+)/gi, /haiku\s*4[^\$]*\$([\d.]+)/gi] },
    ];

    // TODO: Implement actual HTML parsing logic here
    // For now, return null to use pricing.json
    console.warn("⚠️  HTML parsing not fully implemented, using pricing.json");
    return null;
  } catch (error) {
    console.warn(`⚠️  Error parsing pricing HTML: ${error.message}`);
    return null;
  }
}

/**
 * Update Anthropic pricing from scraped data
 */
async function updateAnthropicPricing() {
  try {
    const html = await scrapeAnthropicPricingHTML();
    if (!html) {
      console.log("ℹ️  Using pricing.json for Anthropic pricing");
      return;
    }

    const scrapedPricing = parseAnthropicPricingFromHTML(html);
    if (scrapedPricing) {
      // Update pricing.json with scraped data
      const pricing = loadPricingData();
      pricing.anthropic = { ...pricing.anthropic, ...scrapedPricing };
      writeFileSync(PRICING_FILE, JSON.stringify(pricing, null, 2) + "\n", "utf-8");
      console.log("✅ Updated Anthropic pricing from scraped data");
    }
  } catch (error) {
    console.warn(`⚠️  Could not update Anthropic pricing: ${error.message}`);
  }
}

/**
 * Get Anthropic pricing - loaded from pricing.json (or scraped if available)
 * Prices are per 1k tokens (converted from per 1M tokens)
 */
function getAnthropicPricing(modelId) {
  const id = modelId.toLowerCase();
  const pricing = loadPricingData().anthropic;

  // Try exact match
  if (pricing[id]) {
    return pricing[id];
  }

  // Pattern matching
  if (
    id.includes("sonnet") &&
    id.includes("4") &&
    (id.includes("2025") || id.includes("50514"))
  ) {
    return pricing["claude-sonnet-4-20250514"] || { input: 0.003, output: 0.015 };
  }
  if (id.includes("opus") && (id.includes("4") || id.includes("4.1"))) {
    return pricing["claude-opus-4.1"] || { input: 0.003, output: 0.015 };
  }
  if (id.includes("sonnet") && (id.includes("4") || id.includes("4.5"))) {
    return pricing["claude-sonnet-4.5"] || { input: 0.003, output: 0.015 };
  }
  if (id.includes("haiku") && (id.includes("4") || id.includes("4.5"))) {
    return pricing["claude-haiku-4.5"] || { input: 0.003, output: 0.015 };
  }
  if (id.includes("opus")) {
    return pricing["claude-3-opus-20240229"] || { input: 0.003, output: 0.015 };
  }
  if (id.includes("sonnet")) {
    return pricing["claude-3-5-sonnet-20241022"] || { input: 0.003, output: 0.015 };
  }
  if (id.includes("haiku")) {
    return pricing["claude-3-haiku-20240307"] || { input: 0.003, output: 0.015 };
  }

  // Default fallback
  return { input: 0.003, output: 0.015 };
}

/**
 * Fetch available models from Grok API
 */
async function fetchGrokModels(apiKey) {
  try {
    if (apiKey) {
      console.log("📡 Fetching models from Grok API...");
      try {
        // Grok uses OpenAI-compatible API
        const response = await httpsRequest("https://api.x.ai/v1/models", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

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
      } catch (error) {
        console.warn(`⚠️  Could not fetch Grok models: ${error.message}`);
      }
    } else {
      console.log(
        "ℹ️  GROK_API_KEY not set, using known Grok models as fallback"
      );
    }

    // Use known models as fallback
    return loadFallbackModels().grok;
  } catch (error) {
    console.warn(`⚠️  Error fetching Grok models: ${error.message}`);
    return loadFallbackModels().grok;
  }
}

/**
 * Get Grok pricing - loaded from pricing.json
 */
function getGrokPricing(modelId) {
  const pricing = loadPricingData().grok;
  return pricing[modelId] || { input: 0.001, output: 0.001 };
}

/**
 * Get context window for a model
 */
function getContextWindow(provider, modelId) {
  const id = modelId.toLowerCase();

  const contextWindows = {
    openai: {
      "gpt-5-pro": 400000,
      "gpt-5": 128000,
      "gpt-5-mini": 128000,
      "gpt-5-nano": 128000,
      "gpt-4o": 128000,
      "gpt-4o-mini": 128000,
      "gpt-4-turbo": 128000,
      "gpt-4": 8192,
      "gpt-3.5-turbo": 16385,
    },
    anthropic: {
      "claude-opus-4.1": 200000,
      "claude-sonnet-4.5": 200000,
      "claude-haiku-4.5": 200000,
      "claude-3-5-sonnet-20241022": 200000,
      "claude-3-5-sonnet-20240620": 200000,
      "claude-3-opus-20240229": 200000,
      "claude-3-sonnet-20240229": 200000,
      "claude-3-haiku-20240307": 200000,
    },
    grok: {
      "grok-beta": 8192,
      "grok-2": 131072,
    },
  };

  // Try exact match
  if (contextWindows[provider]?.[id]) {
    return contextWindows[provider][id];
  }

  // Pattern matching
  if (provider === "openai") {
    if (id.includes("gpt-5-pro")) return 400000;
    if (
      id.includes("gpt-5") ||
      id.includes("gpt-4o") ||
      id.includes("gpt-4-turbo") ||
      id.includes("o3")
    ) {
      return 128000;
    }
    if (id.includes("gpt-4") && !id.includes("turbo") && !id.includes("o")) {
      return 8192;
    }
    if (id.includes("gpt-3.5")) {
      return 16385;
    }
    return 128000; // Default for newer models
  }

  if (provider === "anthropic") {
    return 200000; // All Claude 3+ and 4+ models have 200k
  }

  if (provider === "grok") {
    return id.includes("grok-2") ? 131072 : 8192;
  }

  return 128000; // Default
}

/**
 * Determine if a model is the "smartest" for its provider
 */
function isSmartestModel(provider, modelId, allModelIds) {
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
async function updateModels() {
  console.log("🔄 Dynamically fetching and updating models.json...\n");

  try {
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const grokKey = process.env.GROK_API_KEY;

    // Fetch models from APIs
    const openaiModels = await fetchOpenAIModels(openaiKey);
    const anthropicModels = await fetchAnthropicModels(anthropicKey);
    const grokModels = await fetchGrokModels(grokKey);

    // Build new models structure
    const newModels = {
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
      const modelIds = openaiModels.map((m) => m.id);
      let smartestModelId = null;

      // First pass: find the smartest model
      for (const model of openaiModels) {
        if (isSmartestModel("openai", model.id, modelIds)) {
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
        smartestModelId || newModels.openai.models[0]?.id;
      newModels.openai.defaultModel = newModels.openai.models[0]?.id;
    }

    // Process Anthropic models
    if (anthropicModels && anthropicModels.length > 0) {
      const modelIds = anthropicModels.map((m) => m.id);
      let smartestModelId = null;

      // First pass: find the smartest model
      for (const model of anthropicModels) {
        if (isSmartestModel("anthropic", model.id, modelIds)) {
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
        smartestModelId || newModels.anthropic.models[0]?.id;
      newModels.anthropic.defaultModel = newModels.anthropic.models[0]?.id;
    }

    // Process Grok models
    if (grokModels && grokModels.length > 0) {
      const modelIds = grokModels.map((m) => m.id);
      let smartestModelId = null;

      // First pass: find the smartest model
      for (const model of grokModels) {
        if (isSmartestModel("grok", model.id, modelIds)) {
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
        smartestModelId || newModels.grok.models[0]?.id;
      newModels.grok.defaultModel = newModels.grok.models[0]?.id;
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

    return true;
  } catch (error) {
    console.error("❌ Error updating models.json:", error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateModels();
}

export { updateModels };
