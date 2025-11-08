import { logger } from './logger.js';

export interface CircuitBreakerOptions {
  failureThreshold?: number; // Number of failures before opening circuit
  resetTimeout?: number; // Time in ms before attempting to close circuit
  halfOpenMaxAttempts?: number; // Max attempts in half-open state
}

const DEFAULT_OPTIONS: Required<CircuitBreakerOptions> = {
  failureThreshold: 5,
  resetTimeout: 60000, // 1 minute
  halfOpenMaxAttempts: 3,
};

export enum CircuitState {
  CLOSED = 'closed', // Normal operation
  OPEN = 'open', // Circuit is open, failing fast
  HALF_OPEN = 'half-open', // Testing if service recovered
}

/**
 * Circuit Breaker pattern implementation
 * Prevents cascading failures by stopping requests to failing services
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private halfOpenAttempts: number = 0;
  private readonly options: Required<CircuitBreakerOptions>;

  constructor(options: CircuitBreakerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should transition from OPEN to HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure >= this.options.resetTimeout) {
        this.transitionToHalfOpen();
      } else {
        throw new Error(
          `Circuit breaker is OPEN. Service unavailable. Retry after ${Math.ceil((this.options.resetTimeout - timeSinceLastFailure) / 1000)}s`
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get failure count
   */
  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.halfOpenAttempts = 0;
    this.lastFailureTime = 0;
    logger.info('Circuit breaker manually reset');
  }

  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      // Success in half-open state, close the circuit
      this.state = CircuitState.CLOSED;
      this.halfOpenAttempts = 0;
      logger.info('Circuit breaker: HALF_OPEN -> CLOSED (service recovered)');
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.options.halfOpenMaxAttempts) {
        // Still failing, open the circuit again
        this.state = CircuitState.OPEN;
        this.halfOpenAttempts = 0;
        logger.warn('Circuit breaker: HALF_OPEN -> OPEN (service still failing)');
      }
    } else if (this.state === CircuitState.CLOSED && this.failureCount >= this.options.failureThreshold) {
      // Too many failures, open the circuit
      this.state = CircuitState.OPEN;
      logger.warn(
        `Circuit breaker: CLOSED -> OPEN (${this.failureCount} failures exceeded threshold of ${this.options.failureThreshold})`
      );
    }
  }

  private transitionToHalfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.halfOpenAttempts = 0;
    logger.info('Circuit breaker: OPEN -> HALF_OPEN (testing service recovery)');
  }
}

