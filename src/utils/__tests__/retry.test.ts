import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { retryWithBackoff } from '../retry.js';

describe('retryWithBackoff', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should succeed on first attempt', async () => {
    const fn = async () => Promise.resolve('success');
    const result = await retryWithBackoff(fn);
    expect(result).toBe('success');
  });

  it('should retry on failure and eventually succeed', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('network error');
      }
      return 'success';
    };

    const promise = retryWithBackoff(fn, { maxRetries: 2, initialDelay: 100 });
    
    // Fast-forward timers
    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(200);
    
    const result = await promise;
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('should throw after max retries', async () => {
    const error = new Error('network error');
    const fn = async () => Promise.reject(error);

    const promise = retryWithBackoff(fn, { maxRetries: 2, initialDelay: 100 });
    
    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(200);
    
    await expect(promise).rejects.toThrow('network error');
  });
});
