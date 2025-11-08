import { describe, it, expect, beforeEach } from '@jest/globals';
import { CircuitBreaker, CircuitState } from '../circuit-breaker.js';

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 1000,
      halfOpenMaxAttempts: 2,
    });
  });

  it('should start in CLOSED state', () => {
    expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
  });

  it('should execute successfully in CLOSED state', async () => {
    const fn = async () => Promise.resolve('success');
    const result = await circuitBreaker.execute(fn);
    expect(result).toBe('success');
  });

  it('should open circuit after threshold failures', async () => {
    const fn = async () => Promise.reject(new Error('failure'));

    // Trigger failures up to threshold
    for (let i = 0; i < 3; i++) {
      await expect(circuitBreaker.execute(fn)).rejects.toThrow('failure');
    }

    expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    expect(circuitBreaker.getFailureCount()).toBe(3);
  });

  it('should fail fast when OPEN', async () => {
    const fn = async () => Promise.reject(new Error('failure'));

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await expect(circuitBreaker.execute(fn)).rejects.toThrow();
    }

    // Next call should fail fast
    await expect(circuitBreaker.execute(fn)).rejects.toThrow('Circuit breaker is OPEN');
  });

  it('should reset circuit breaker', () => {
    circuitBreaker.reset();
    expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    expect(circuitBreaker.getFailureCount()).toBe(0);
  });
});
