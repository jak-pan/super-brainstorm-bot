import { describe, it, expect, beforeEach } from '@jest/globals';
import { AdapterRegistry } from '../index.js';
import type { Config } from '../../types/index.js';

describe('AdapterRegistry', () => {
  let config: Config;

  beforeEach(() => {
    config = {
      openai: {
        apiKey: 'test-openai-key',
        model: 'gpt-4-turbo-preview',
      },
      anthropic: {
        apiKey: 'test-anthropic-key',
        model: 'claude-3-opus-20240229',
      },
      grok: {
        apiKey: '',
        model: 'grok-beta',
        baseUrl: 'https://api.x.ai/v1',
      },
      cursor: {
        apiKey: undefined,
        model: undefined,
        baseUrl: undefined,
      },
    } as Config;
  });

  it('should register OpenAI adapter', () => {
    const registry = new AdapterRegistry(config);
    const adapter = registry.getAdapter('chatgpt');

    expect(adapter).toBeDefined();
    expect(adapter?.getModelName()).toBe('ChatGPT');
  });

  it('should register Anthropic adapter', () => {
    const registry = new AdapterRegistry(config);
    const adapter = registry.getAdapter('claude');

    expect(adapter).toBeDefined();
    expect(adapter?.getModelName()).toBe('Claude');
  });

  it('should get adapter by different names', () => {
    const registry = new AdapterRegistry(config);
    const adapter1 = registry.getAdapter('chatgpt');
    const adapter2 = registry.getAdapter('openai');

    expect(adapter1).toBe(adapter2);
  });

  it('should return undefined for non-existent adapter', () => {
    const registry = new AdapterRegistry(config);
    const adapter = registry.getAdapter('nonexistent');

    expect(adapter).toBeUndefined();
  });

  it('should get all available adapters', () => {
    const registry = new AdapterRegistry(config);
    const adapters = registry.getAvailableAdapters();

    expect(adapters.length).toBeGreaterThan(0);
    expect(adapters).toContain('chatgpt');
    expect(adapters).toContain('claude');
  });

  it('should check if adapter exists', () => {
    const registry = new AdapterRegistry(config);

    expect(registry.hasAdapter('chatgpt')).toBe(true);
    expect(registry.hasAdapter('claude')).toBe(true);
    expect(registry.hasAdapter('nonexistent')).toBe(false);
  });
});

