import { logger } from './logger.js';

export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
}

/**
 * Simple rate limiter using token bucket algorithm
 * Tracks requests per time window
 */
export class RateLimiter {
  private requests: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(options: RateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
  }

  /**
   * Check if a request can be made
   * @returns true if request is allowed, false if rate limited
   */
  canMakeRequest(): boolean {
    const now = Date.now();
    
    // Remove requests outside the time window
    this.requests = this.requests.filter((timestamp) => now - timestamp < this.windowMs);
    
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.windowMs - (now - oldestRequest);
      logger.warn(`Rate limit exceeded. Wait ${Math.ceil(waitTime / 1000)}s before retrying.`);
      return false;
    }
    
    return true;
  }

  /**
   * Record a request
   */
  recordRequest(): void {
    this.requests.push(Date.now());
  }

  /**
   * Get the number of requests in the current window
   */
  getRequestCount(): number {
    const now = Date.now();
    this.requests = this.requests.filter((timestamp) => now - timestamp < this.windowMs);
    return this.requests.length;
  }

  /**
   * Get time until next request can be made (in ms)
   * Returns 0 if request can be made now
   */
  getTimeUntilNextRequest(): number {
    if (this.canMakeRequest()) {
      return 0;
    }
    
    const now = Date.now();
    const oldestRequest = this.requests[0];
    return Math.max(0, this.windowMs - (now - oldestRequest));
  }

  /**
   * Reset the rate limiter
   */
  reset(): void {
    this.requests = [];
  }
}

/**
 * Discord rate limiter - respects Discord's 50 requests/second limit
 */
export class DiscordRateLimiter {
  private rateLimiter: RateLimiter;

  constructor() {
    // Discord allows 50 requests per second
    this.rateLimiter = new RateLimiter({
      maxRequests: 50,
      windowMs: 1000, // 1 second
    });
  }

  /**
   * Check if a Discord API request can be made
   */
  canMakeRequest(): boolean {
    return this.rateLimiter.canMakeRequest();
  }

  /**
   * Record a Discord API request
   */
  recordRequest(): void {
    this.rateLimiter.recordRequest();
  }

  /**
   * Wait if rate limited, then record the request
   */
  async waitAndRecord(): Promise<void> {
    const waitTime = this.rateLimiter.getTimeUntilNextRequest();
    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    this.rateLimiter.recordRequest();
  }
}

