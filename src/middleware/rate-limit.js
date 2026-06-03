/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/middleware/rate-limit.js
 */

/**
 * High-performance in-memory store for rate limiting
 */
class RateLimitStore {
  constructor() {
    this.hits = new Map();
  }

  get(key) {
    return this.hits.get(key);
  }

  set(key, record) {
    this.hits.set(key, record);
  }

  prune(now) {
    for (const [key, record] of this.hits) {
      if (now > record.resetTime) {
        this.hits.delete(key);
      }
    }
  }
}

/**
 * Creates a rate limiting middleware.
 * Note: This is a factory function, NOT a class, so it does not require 'new'.
 * 
 * @param {Object} options - Configuration options
 * @returns {Function} Middleware function
 */
export default function createRateLimit(options = {}) {
  const config = {
    windowMs: options.windowMs || 15 * 60 * 1000, // 15 minutes default
    max: options.max || 100,                      // 100 requests per window
    message: options.message || {
      success: false,
      error: "Too Many Requests",
      message: "You have exceeded the rate limit. Please try again later."
    },
    headers: options.headers !== false,           // Send X-RateLimit-* headers
    keyGenerator: options.keyGenerator || ((ctx) => {
      // Extract IP: check X-Forwarded-For first, then socket remoteAddress
      const forwarded = ctx.req?.headers?.['x-forwarded-for'];
      if (forwarded) return typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : forwarded[0];
      return ctx.req?.socket?.remoteAddress || ctx.ip || 'unknown';
    }),
    store: options.store || new RateLimitStore(),
  };

  // Auto-prune expired records to prevent memory leaks
  if (config.store instanceof RateLimitStore) {
    setInterval(() => config.store.prune(Date.now()), config.windowMs).unref();
  }

  return async (ctx, next) => {
    const key = config.keyGenerator(ctx);
    const now = Date.now();
    
    let record = config.store.get(key);
    
    // Reset window if expired, otherwise increment
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + config.windowMs };
      config.store.set(key, record);
    } else {
      record.count++;
    }

    // Set standard rate limit headers
    if (config.headers) {
      ctx.setHeader('X-RateLimit-Limit', config.max);
      ctx.setHeader('X-RateLimit-Remaining', Math.max(0, config.max - record.count));
      ctx.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));
    }

    // Block request if limit exceeded
    if (record.count > config.max) {
      if (config.headers) {
        ctx.setHeader('Retry-After', Math.ceil((record.resetTime - now) / 1000));
      }
      ctx.setStatus(429).json(config.message);
      return; // Stop execution
    }
    
    // Continue to next middleware
    await next();
  };
}
