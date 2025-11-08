#!/usr/bin/env node

/**
 * Script to update models.json with latest model information and pricing
 * Fetches from provider APIs where possible, uses fallback data otherwise
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MODELS_FILE = join(__dirname, '../src/config/models.json');

// Current pricing data (updated from official docs as of latest check)
// Prices are per 1k tokens (converted from per 1M tokens in official docs)
const CURRENT_PRICING = {
  openai: {
    'gpt-4o': { input: 0.0025, output: 0.01, contextWindow: 128000 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006, contextWindow: 128000 },
    'gpt-4-turbo': { input: 0.01, output: 0.03, contextWindow: 128000 },
    'gpt-4': { input: 0.03, output: 0.06, contextWindow: 8192 },
    'gpt-3.5-turbo': { input: 0.0005, output: 0.0015, contextWindow: 16385 },
    // Newer models (if available)
    'gpt-4.1': { input: 0.002, output: 0.008, contextWindow: 128000 },
    'gpt-4.1-mini': { input: 0.0004, output: 0.0016, contextWindow: 128000 },
    'o3-mini': { input: 0.001, output: 0.004, contextWindow: 128000 },
  },
  anthropic: {
    'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015, contextWindow: 200000 },
    'claude-3-5-sonnet-20240620': { input: 0.003, output: 0.015, contextWindow: 200000 },
    'claude-3-opus-20240229': { input: 0.015, output: 0.075, contextWindow: 200000 },
    'claude-3-sonnet-20240229': { input: 0.003, output: 0.015, contextWindow: 200000 },
    'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125, contextWindow: 200000 },
    // Newer models (if available)
    'claude-opus-4': { input: 0.015, output: 0.075, contextWindow: 200000 },
    'claude-sonnet-4': { input: 0.003, output: 0.015, contextWindow: 200000 },
  },
  grok: {
    'grok-beta': { input: 0.001, output: 0.001, contextWindow: 8192 },
    'grok-2': { input: 0.001, output: 0.001, contextWindow: 131072 },
  },
};

/**
 * Fetch available models from OpenAI API
 */
async function fetchOpenAIModels(apiKey) {
  if (!apiKey) return null;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/models',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`OpenAI API returned status ${res.statusCode}`));
            return;
          }
          const json = JSON.parse(data);
          resolve(json.data || []);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

/**
 * Update models.json with latest information
 */
async function updateModels() {
  console.log('🔄 Updating models.json with latest information...\n');

  try {
    // Load current models.json
    const currentModels = JSON.parse(readFileSync(MODELS_FILE, 'utf-8'));

    // Try to fetch from OpenAI API if key is available
    const openaiKey = process.env.OPENAI_API_KEY;
    let openaiModelIds = [];
    
    if (openaiKey) {
      try {
        console.log('📡 Fetching available models from OpenAI API...');
        const openaiModels = await fetchOpenAIModels(openaiKey);
        if (openaiModels && openaiModels.length > 0) {
          openaiModelIds = openaiModels
            .map(m => m.id)
            .filter(id => id.startsWith('gpt-') || id.startsWith('o'));
          
          console.log(`✅ Found ${openaiModelIds.length} OpenAI models: ${openaiModelIds.slice(0, 5).join(', ')}${openaiModelIds.length > 5 ? '...' : ''}`);
          
          // Mark unavailable models
          currentModels.openai.models.forEach(model => {
            model.available = openaiModelIds.includes(model.id);
          });
        }
      } catch (error) {
        console.warn('⚠️  Could not fetch OpenAI models:', error.message);
        console.warn('   Using fallback availability status\n');
      }
    } else {
      console.log('ℹ️  OPENAI_API_KEY not set, skipping API fetch\n');
    }

    // Update pricing from current pricing data
    console.log('💰 Updating pricing information...');
    
    let updatedCount = 0;
    
    // Update OpenAI pricing
    currentModels.openai.models.forEach(model => {
      const pricing = CURRENT_PRICING.openai[model.id];
      if (pricing) {
        const oldInput = model.pricing.input;
        const oldOutput = model.pricing.output;
        model.pricing.input = pricing.input;
        model.pricing.output = pricing.output;
        if (pricing.contextWindow) {
          model.contextWindow = pricing.contextWindow;
        }
        if (oldInput !== pricing.input || oldOutput !== pricing.output) {
          updatedCount++;
          console.log(`   Updated ${model.id}: $${pricing.input}/1k input, $${pricing.output}/1k output`);
        }
      }
    });

    // Update Anthropic pricing
    currentModels.anthropic.models.forEach(model => {
      const pricing = CURRENT_PRICING.anthropic[model.id];
      if (pricing) {
        const oldInput = model.pricing.input;
        const oldOutput = model.pricing.output;
        model.pricing.input = pricing.input;
        model.pricing.output = pricing.output;
        if (pricing.contextWindow) {
          model.contextWindow = pricing.contextWindow;
        }
        if (oldInput !== pricing.input || oldOutput !== pricing.output) {
          updatedCount++;
          console.log(`   Updated ${model.id}: $${pricing.input}/1k input, $${pricing.output}/1k output`);
        }
      }
    });

    // Update Grok pricing
    currentModels.grok.models.forEach(model => {
      const pricing = CURRENT_PRICING.grok[model.id];
      if (pricing) {
        const oldInput = model.pricing.input;
        const oldOutput = model.pricing.output;
        model.pricing.input = pricing.input;
        model.pricing.output = pricing.output;
        if (pricing.contextWindow) {
          model.contextWindow = pricing.contextWindow;
        }
        if (oldInput !== pricing.input || oldOutput !== pricing.output) {
          updatedCount++;
          console.log(`   Updated ${model.id}: $${pricing.input}/1k input, $${pricing.output}/1k output`);
        }
      }
    });

    // Write updated models.json
    writeFileSync(MODELS_FILE, JSON.stringify(currentModels, null, 2) + '\n', 'utf-8');
    
    console.log(`\n✅ models.json updated successfully!`);
    if (updatedCount > 0) {
      console.log(`   ${updatedCount} model(s) had pricing updates`);
    } else {
      console.log(`   No pricing changes detected`);
    }
    console.log('\n📝 Note: Pricing is updated from CURRENT_PRICING in this script.');
    console.log('   To update pricing, edit CURRENT_PRICING in scripts/update-models.js');
    console.log('   or check provider pricing pages:');
    console.log('   - OpenAI: https://openai.com/api/pricing/');
    console.log('   - Anthropic: https://www.anthropic.com/pricing');
    console.log('   - Grok: https://x.ai/pricing\n');

    return true;
  } catch (error) {
    console.error('❌ Error updating models.json:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateModels();
}

export { updateModels };

