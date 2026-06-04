/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/middleware/session
 */

import crypto from "crypto";
import redis from "redis";

// Ultimate optimization: Use the most primitive, zero object allocation for-loop for single-point cookie lookup, reducing GC overhead to absolute zero
function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return undefined;
  const target = name + "=";
  const len = cookieHeader.length;
  let pos = 0;
  while (pos < len) {
    pos = cookieHeader.indexOf(target, pos);
    if (pos === -1) break;
    // Ensure it's an independent cookie name, not a prefix of another
    if (
      pos === 0 ||
      cookieHeader.charCodeAt(pos - 1) === 32 ||
      cookieHeader.charCodeAt(pos - 1) === 59
    ) {
      pos += target.length;
      let end = cookieHeader.indexOf(";", pos);
      if (end === -1) end = len;
      return cookieHeader.substring(pos, end).trim();
    }
    pos += 1;
  }
  return undefined;
}

// Abandon long UUID, use 16-byte high-performance hexadecimal ID, shorten cookie length, reduce network and compression middleware overhead
const genId = () => crypto.randomBytes(16).toString("hex");

class MemoryStore {
  constructor() {
    this.cache = new Map();
  }
  async get(id) {
    const s = this.cache.get(id);
    if (!s) return null;
    if (Date.now() > s.exp) {
      this.cache.delete(id);
      return null;
    }
    return s.data;
  }
  async set(id, data, ttl) {
    this.cache.set(id, { data, exp: Date.now() + ttl });
  }
  async delete(id) {
    this.cache.delete(id);
  }
  prune() {
    const now = Date.now();
    for (const [k, v] of this.cache) if (now > v.exp) this.cache.delete(k);
  }
}

// Redis store implementation for distributed session sharing across multiple URLs/servers
class RedisStore {
  constructor(client) {
    this.client = client;
    this.prefix = "sess:";
  }

  async get(id) {
    try {
      const data = await this.client.get(`${this.prefix}${id}`);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.error("[RedisStore] Get error:", err);
      return null;
    }
  }

  async set(id, data, ttl) {
    try {
      // Store session data with TTL in seconds
      await this.client.setEx(
        `${this.prefix}${id}`,
        Math.floor(ttl / 1000),
        JSON.stringify(data)
      );
    } catch (err) {
      console.error("[RedisStore] Set error:", err);
    }
  }

  async delete(id) {
    try {
      await this.client.del(`${this.prefix}${id}`);
    } catch (err) {
      console.error("[RedisStore] Delete error:", err);
    }
  }

  prune() {
    // Redis handles expiration automatically via TTL
  }
}

export class SessionManager {
  constructor(options = {}) {
    const { store, ...restOptions } = options;
    
    // Configuration from environment variables or defaults
    this.config = {
      enabled: process.env.SESSION_ENABLED !== "false",
      maxAge: parseInt(process.env.SESSION_MAX_AGE) || 86400000, // Default 24 hours
      cookieName: process.env.SESSION_COOKIE_NAME || "aether_sid",
      cookieDomain: process.env.SESSION_COOKIE_DOMAIN || null,
      cookiePath: process.env.SESSION_COOKIE_PATH || "/",
      cookieSecure: process.env.SESSION_COOKIE_SECURE === "true",
      cookieSameSite: process.env.SESSION_COOKIE_SAME_SITE || "Lax",
      ...restOptions,
    };

    // Determine store type based on Redis configuration
    // Only use RedisStore if REDIS_ENABLED is true AND Redis host/port are provided
    const redisEnabled = process.env.REDIS_ENABLED === 'true';
    const redisHost = process.env.REDIS_HOST;
    const redisPort = process.env.REDIS_PORT;
    const redisDb = process.env.REDIS_DB;
    const redisPassword = process.env.REDIS_PASSWORD;

    // Check if Redis should be used based on both REDIS_ENABLED switch and Redis configuration
    if (redisEnabled && redisHost && redisPort) {
      try {
        // Create Redis client with configuration from environment variables
        const redisClient = redis.createClient({
          socket: {
            host: redisHost,
            port: parseInt(redisPort),
          },
          database: parseInt(redisDb) || 0,
          password: redisPassword || undefined,
        });

        // Connect to Redis asynchronously
        redisClient.connect().catch((err) => {
          console.error("[SessionManager] Failed to connect to Redis:", err);
        });

        this.config.store = new RedisStore(redisClient);
        console.log("[SessionManager] Using Redis store for session sharing");
      } catch (err) {
        console.warn("[SessionManager] Redis initialization failed, falling back to MemoryStore:", err);
        this.config.store = store && typeof store === "object" ? store : new MemoryStore();
      }
    } else {
      // Use provided store or default to MemoryStore for local/single-URL scenarios
      this.config.store = store && typeof store === "object" ? store : new MemoryStore();
      
      // Log the reason for using MemoryStore
      if (!redisEnabled) {
        console.log("[SessionManager] Using Memory store (REDIS_ENABLED is false)");
      } else if (!redisHost || !redisPort) {
        console.log("[SessionManager] Using Memory store (Redis host or port not configured)");
      } else {
        console.log("[SessionManager] Using Memory store (local/single-URL mode)");
      }
    }

    // Start cleanup interval only for MemoryStore to prevent memory leaks
    if (this.config.store instanceof MemoryStore) {
      this.cleanup = setInterval(
        () => this.config.store.prune(),
        60000,
      ).unref();
    }
  }

  middleware() {
    if (!this.config.enabled)
      return (ctx, next) => next && (next.next ? next.next() : next());

    const { store, maxAge, cookieName, cookieDomain, cookiePath, cookieSecure, cookieSameSite } = this.config;
    
    // Build cookie suffix based on configuration
    const cookieSuffixParts = [
      "HttpOnly",
      cookieSecure ? "Secure" : "",
      `SameSite=${cookieSameSite}`,
      `Max-Age=${Math.floor(maxAge / 1000)}`,
      `Path=${cookiePath}`,
      cookieDomain ? `Domain=${cookieDomain}` : ""
    ].filter(Boolean).join("; ");

    return async (ctx, next) => {
      ctx.state ??= {};

      // Extract session ID from cookie
      const sid = getCookieValue(ctx.getHeader("cookie"), cookieName);
      
      // Retrieve session data from store
      let sessionData = sid ? await store.get(sid) : null;

      // Initialize new session if not found
      let isNew = false;
      if (!sessionData) {
        sessionData = {};
        isNew = true;
      }

      // Session state tracker
      const sessionState = { id: sid, data: sessionData, dirty: false };

      // Expose session API to context
      ctx.session = {
        get: (key) => sessionState.data[key],
        set: (key, val) => {
          sessionState.data[key] = val;
          sessionState.dirty = true;
        },
        delete: (key) => {
          delete sessionState.data[key];
          sessionState.dirty = true;
        },
        clear: () => {
          sessionState.data = {};
          sessionState.dirty = true;
        },
        destroy: async () => {
          if (sessionState.id) await store.delete(sessionState.id);
          sessionState.id = null;
          sessionState.data = {};
          sessionState.dirty = false;
          // Clear cookie by setting Max-Age to 0
          ctx.setHeader(
            "Set-Cookie",
            `${cookieName}=; HttpOnly; ${cookieSecure ? "Secure; " : ""}SameSite=${cookieSameSite}; Max-Age=0; Path=${cookiePath}${cookieDomain ? `; Domain=${cookieDomain}` : ""}`,
          );
        },
        regenerate: async () => {
          if (sessionState.id) await store.delete(sessionState.id);
          sessionState.id = genId();
          await store.set(sessionState.id, sessionState.data, maxAge);
          ctx.setHeader(
            "Set-Cookie",
            `${cookieName}=${sessionState.id}; ${cookieSuffixParts}`,
          );
          sessionState.dirty = false;
          isNew = false;
        },
        getId: () => sessionState.id,
        getAllData: () => ({ ...sessionState.data }),
      };

      // Execute next middleware and handle session persistence in finally block
      try {
        if (next) {
          next.next ? await next.next() : await next();
        }
      } finally {
        // Only save session if data was modified
        if (sessionState.dirty) {
          // Generate new ID for new sessions with data
          if (isNew || !sessionState.id) {
            sessionState.id = genId();
            ctx.setHeader(
              "Set-Cookie",
              `${cookieName}=${sessionState.id}; ${cookieSuffixParts}`,
            );
          }
          // Persist session data to store (Memory or Redis)
          await store.set(sessionState.id, sessionState.data, maxAge);
        }
      }
    };
  }

  destroy() {
    if (this.cleanup) clearInterval(this.cleanup);
  }
}

export default SessionManager;
