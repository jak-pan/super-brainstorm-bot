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
    return [
      { id: "gpt-5-pro", name: "GPT-5 Pro" },
      { id: "gpt-5", name: "GPT-5" },
      { id: "gpt-5-mini", name: "GPT-5 Mini" },
      { id: "gpt-5-nano", name: "GPT-5 Nano" },
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
      { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
    ];
  } catch (error) {
    console.warn(`⚠️  Could not fetch OpenAI models: ${error.message}`);
    console.warn("   Using known current models as fallback");
    // Return known current models as fallback
    return [
      { id: "gpt-5-pro", name: "GPT-5 Pro" },
      { id: "gpt-5", name: "GPT-5" },
      { id: "gpt-5-mini", name: "GPT-5 Mini" },
      { id: "gpt-5-nano", name: "GPT-5 Nano" },
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
      { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
    ];
  }
}

/**
 * Get OpenAI pricing - updated with latest pricing from official sources
 * Prices are per 1k tokens (converted from per 1M tokens)
 */
function getOpenAIPricing(modelId) {
  const id = modelId.toLowerCase();

  // Latest pricing (as of November 2025) - update when pricing changes
  // Prices are per 1k tokens
  const pricingMap = {
    // GPT-5 series (latest)
    "gpt-5-pro": { input: 0.015, output: 0.12 },
    "gpt-5": { input: 0.00125, output: 0.01 },
    "gpt-5-mini": { input: 0.00025, output: 0.002 },
    "gpt-5-nano": { input: 0.00005, output: 0.0004 },
    // GPT-4o series
    "gpt-4o": { input: 0.0025, output: 0.01 },
    "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
    // GPT-4 series
    "gpt-4-turbo": { input: 0.01, output: 0.03 },
    "gpt-4": { input: 0.03, output: 0.06 },
    // GPT-3.5 series
    "gpt-3.5-turbo": { input: 0.0005, output: 0.0015 },
  };

  // Try exact match first
  if (pricingMap[id]) {
    return pricingMap[id];
  }

  // Pattern matching for variants
  if (id.includes("gpt-5-pro")) return pricingMap["gpt-5-pro"];
  if (id.includes("gpt-5") && id.includes("mini"))
    return pricingMap["gpt-5-mini"];
  if (id.includes("gpt-5") && id.includes("nano"))
    return pricingMap["gpt-5-nano"];
  if (id.includes("gpt-5")) return pricingMap["gpt-5"];
  if (id.includes("gpt-4o") && id.includes("mini"))
    return pricingMap["gpt-4o-mini"];
  if (id.includes("gpt-4o")) return pricingMap["gpt-4o"];
  if (id.includes("gpt-4-turbo")) return pricingMap["gpt-4-turbo"];
  if (id.includes("gpt-4") && !id.includes("turbo") && !id.includes("o"))
    return pricingMap["gpt-4"];
  if (id.includes("gpt-3.5")) return pricingMap["gpt-3.5-turbo"];

  // Default fallback pricing
  return { input: 0.002, output: 0.008 };
}

/**
 * Fetch available models from Anthropic API
 * Anthropic doesn't have a public models endpoint, so we use known current models
 */
async function fetchAnthropicModels(apiKey) {
  try {
    console.log("📡 Fetching Anthropic models...");
    // Anthropic doesn't have a public models list endpoint
    // Use known current models (latest as of November 2025)
    const knownModels = [
      "claude-opus-4.1",
      "claude-sonnet-4.5",
      "claude-haiku-4.5",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-sonnet-20240620",
      "claude-3-opus-20240229",
      "claude-3-sonnet-20240229",
      "claude-3-haiku-20240307",
    ];

    console.log(
      `✅ Using known Anthropic models: ${knownModels.length} models`
    );
    return knownModels.map((id) => ({ id, name: id }));
  } catch (error) {
    console.warn(`⚠️  Could not fetch Anthropic models: ${error.message}`);
    // Return known models as fallback
    return [
      { id: "claude-opus-4.1", name: "Claude Opus 4.1" },
      { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
      { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
    ];
  }
}

/**
 * Get Anthropic pricing - updated with latest pricing
 * Prices are per 1k tokens (converted from per 1M tokens)
 */
function getAnthropicPricing(modelId) {
  const id = modelId.toLowerCase();

  // Latest pricing (as of November 2025) - update when pricing changes
  // Prices are per 1k tokens
  const pricingMap = {
    // Claude 4 series (latest)
    "claude-opus-4.1": { input: 0.015, output: 0.075 },
    "claude-sonnet-4.5": { input: 0.003, output: 0.015 },
    "claude-haiku-4.5": { input: 0.001, output: 0.005 },
    // Claude 3.5 series
    "claude-3-5-sonnet-20241022": { input: 0.003, output: 0.015 },
    "claude-3-5-sonnet-20240620": { input: 0.003, output: 0.015 },
    // Claude 3 series
    "claude-3-opus-20240229": { input: 0.015, output: 0.075 },
    "claude-3-sonnet-20240229": { input: 0.003, output: 0.015 },
    "claude-3-haiku-20240307": { input: 0.00025, output: 0.00125 },
  };

  // Try exact match
  if (pricingMap[id]) {
    return pricingMap[id];
  }

  // Pattern matching
  if (id.includes("opus") && (id.includes("4") || id.includes("4.1"))) {
    return pricingMap["claude-opus-4.1"];
  }
  if (id.includes("sonnet") && (id.includes("4") || id.includes("4.5"))) {
    return pricingMap["claude-sonnet-4.5"];
  }
  if (id.includes("haiku") && (id.includes("4") || id.includes("4.5"))) {
    return pricingMap["claude-haiku-4.5"];
  }
  if (id.includes("opus")) {
    return pricingMap["claude-3-opus-20240229"];
  }
  if (id.includes("sonnet")) {
    return pricingMap["claude-3-5-sonnet-20241022"];
  }
  if (id.includes("haiku")) {
    return pricingMap["claude-3-haiku-20240307"];
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
    return [
      { id: "grok-beta", name: "Grok Beta" },
      { id: "grok-2", name: "Grok-2" },
    ];
  } catch (error) {
    console.warn(`⚠️  Error fetching Grok models: ${error.message}`);
    // Return known models as fallback
    return [
      { id: "grok-beta", name: "Grok Beta" },
      { id: "grok-2", name: "Grok-2" },
    ];
  }
}

/**
 * Get Grok pricing
 */
function getGrokPricing(modelId) {
  // Known pricing - update when Grok updates pricing
  // Prices are per 1k tokens
  const pricingMap = {
    "grok-beta": { input: 0.001, output: 0.001 },
    "grok-2": { input: 0.001, output: 0.001 },
  };

  return pricingMap[modelId] || { input: 0.001, output: 0.001 };
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
    // Claude Opus 4.1 is smartest, then Sonnet 4.5, then 3.5 Sonnet
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

      openaiModels.forEach((model) => {
        const pricing = getOpenAIPricing(model.id);
        const contextWindow = getContextWindow("openai", model.id);
        const isSmartest = isSmartestModel("openai", model.id, modelIds);

        if (isSmartest && !smartestModelId) {
          smartestModelId = model.id;
        }

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

      anthropicModels.forEach((model) => {
        const pricing = getAnthropicPricing(model.id);
        const contextWindow = getContextWindow("anthropic", model.id);
        const isSmartest = isSmartestModel("anthropic", model.id, modelIds);

        if (isSmartest && !smartestModelId) {
          smartestModelId = model.id;
        }

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

      grokModels.forEach((model) => {
        const pricing = getGrokPricing(model.id);
        const contextWindow = getContextWindow("grok", model.id);
        const isSmartest = isSmartestModel("grok", model.id, modelIds);

        if (isSmartest && !smartestModelId) {
          smartestModelId = model.id;
        }

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
