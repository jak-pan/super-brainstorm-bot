import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROMPTS_DIR = join(__dirname, '../prompts');

export class PromptLoader {
  private static cache: Map<string, string> = new Map();

  /**
   * Load a prompt from file, with caching
   */
  static loadPrompt(filename: string, replacements?: Record<string, string | number>): string {
    const cacheKey = `${filename}:${JSON.stringify(replacements || {})}`;
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      const filePath = join(PROMPTS_DIR, filename);
      let content = readFileSync(filePath, 'utf-8');

      // Apply replacements if provided
      if (replacements) {
        for (const [key, value] of Object.entries(replacements)) {
          content = content.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
        }
      }

      this.cache.set(cacheKey, content);
      return content;
    } catch (error) {
      throw new Error(`Failed to load prompt file ${filename}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Clear the prompt cache (useful for development/testing)
   */
  static clearCache(): void {
    this.cache.clear();
  }
}

