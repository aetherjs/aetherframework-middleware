/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * @module @aetherframework/middleware/middleware/session
 */

import crypto from "crypto";
import { createRequire } from "module";

/**
 * [V8-OPT] Zero allocation cookie lookup.
 * Parses the cookie header string manually to avoid the overhead of splitting 
 * and creating intermediate arrays/objects, ensuring high performance.
 * 
 * @param {string|undefined} cookieHeader - The raw 'Cookie' header from the request.
 * @param {string} name - The name of the cookie to extract.
 * @returns {string|undefined} The value of the cookie, or undefined if not found.
 */
function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return undefined;
  
  const target = name + "=";
  const len = cookieHeader.length;
  let pos = 0;
  
  while (pos < len) {
    pos = cookieHeader.indexOf(target, pos);
    if (pos === -1) break;
    
    // Ensure we match the exact cookie name (preceded by start of string, space, or semicolon)
    if (pos === 0 || cookieHeader.charCodeAt(pos - 1) === 32 || cookieHeader.charCodeAt(pos - 1) === 59) {
      pos += target.length;
      let end = cookieHeader.indexOf(";", pos);
      if (end === -1) end = len;
      return cookieHeader.substring(pos, end).trim();
    }
    pos += 1;
  }
  
  return undefined;
}

/**
 * Generates a cryptographically secure random session ID.
 * @returns {string} A 32-character hex string.
 */
const genId = () => crypto.randomBytes(16).toString("hex");

/**
 * In-memory session store. 
 * Used as the default fallback when Redis is disabled or unavailable.
 */
class MemoryStore {
  constructor() { 
    /** @type {Map<string, {data: any, exp: number}>} */
    this.cache = new Map(); 
  }

  /**
   * Retrieves session data if it exists and hasn't expired.
   * @param {string} id - Session ID.
   * @returns {Promise<any|null>} Session data or null.
   */
  async get(id) { 
    const s = this.cache.get(id); 
    if (!s) return null; 
    if (Date.now() > s.exp) { 
      this.cache.delete(id); 
      return null; 
    } 
    return s.data; 
  }

  /**
   * Saves session data with an expiration timestamp.
   * @param {string} id - Session ID.
   * @param {any} data - Session payload.
   * @param {number} ttl - Time to live in milliseconds.
   */
  async set(id, data, ttl) { 
    this.cache.set(id, { data, exp: Date.now() + ttl }); 
  }

  /**
   * Deletes a specific session.
   * @param {string} id - Session ID.
   */
  async delete(id) { 
    this.cache.delete(id); 
  }

  /**
   * Cleans up expired sessions to prevent memory leaks.
   */
  prune() { 
    const now = Date.now(); 
    for (const [k, v] of this.cache) {
      if (now > v.exp) this.cache.delete(k); 
    }
  }
}

/**
 * Redis-backed session store for distributed/production environments.
 */
class RedisStore {
  /**
   * @param {import('redis').RedisClientType} client - Connected Redis client instance.
   */
  constructor(client) { 
    this.client = client; 
    this.prefix = "sess:"; 
  }

  async get(id) { 
    try { 
      const data = await this.client.get(`${this.prefix}${id}`); 
      return data ? JSON.parse(data) : null; 
    } catch (err) { 
      return null; 
    } 
  }

  async set(id, data, ttl) { 
    try { 
      // Redis SETEX expects TTL in seconds
      await this.client.setEx(`${this.prefix}${id}`, Math.floor(ttl / 1000), JSON.stringify(data)); 
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

  // Redis handles expiration natively via TTL, so manual pruning is not needed.
  prune() {}
}

/**
 * [V8-OPT] Safe boolean parser for environment variables.
 * Handles various truthy/falsy string representations safely.
 * 
 * @param {string} key - Environment variable name.
 * @param {boolean} defaultValue - Fallback value if undefined.
 * @returns {boolean} Parsed boolean value.
 */
function isEnvEnabled(key, defaultValue = false) {
  const val = process.env[key];
  if (val === undefined || val === null) return defaultValue;
  if (val === 'true' || val === '1') return true;
  if (val === 'false' || val === '0' || val === '') return false;
  return ['true', '1', 'yes', 'on'].includes(val.toLowerCase().trim());
}

/**
 * Safely attempts to load the 'redis' package synchronously.
 * Prevents the application from crashing if the package is not installed 
 * and Redis is not being used.
 * 
 * @returns {typeof import('redis') | null} The redis module or null if unavailable.
 */
function loadRedisModule() {
  try {
    // Attempt to get import.meta.url safely to avoid SyntaxError in pure CommonJS environments
    // @ts-ignore
    const metaUrl = typeof import.meta !== "undefined" && import.meta !== null ? import.meta.url : undefined;
    
    if (metaUrl) {
      // Node.js ESM environment: use createRequire to load CommonJS modules synchronously
      const require = createRequire(metaUrl);
      return require("redis");
    } else {
      // Node.js CommonJS environment: use global require
      // @ts-ignore
      return typeof require === "function" ? require("redis") : null;
    }
  } catch (err) {
    // Module not found or environment restriction
    return null;
  }
}

/**
 * Core Session Manager.
 * Handles configuration, store initialization, and middleware generation.
 */
export class SessionManager {
  /**
   * @param {object} options - Configuration overrides.
   */
  constructor(options = {}) {
    const { store, ...restOptions } = options;
    
    this.config = {
      // [FIX] Use strict boolean parsing for environment variables
      enabled: isEnvEnabled('SESSION_ENABLED', false), 
      maxAge: parseInt(process.env.SESSION_MAX_AGE) || 86400000, // Default: 24 hours
      cookieName: process.env.SESSION_COOKIE_NAME || "aether_sid",
      cookieDomain: process.env.SESSION_COOKIE_DOMAIN || null,
      cookiePath: process.env.SESSION_COOKIE_PATH || "/",
      cookieSecure: isEnvEnabled('SESSION_COOKIE_SECURE', false),
      cookieSameSite: process.env.SESSION_COOKIE_SAME_SITE || "Lax",
      ...restOptions,
    };

    const redisEnabled = isEnvEnabled('REDIS_ENABLED', false);
    const redisHost = process.env.REDIS_HOST;
    const redisPort = process.env.REDIS_PORT;

    // Initialize Store based on environment and configuration
    if (redisEnabled && redisHost && redisPort) {
      // Lazily load the redis package only if Redis is actually enabled
      const redis = loadRedisModule();
      
      if (!redis) {
        console.warn("[SessionManager] REDIS_ENABLED is true, but the 'redis' package is not installed. Falling back to MemoryStore.");
        this.config.store = store || new MemoryStore();
      } else {
        try {
          const redisClient = redis.createClient({
            socket: { host: redisHost, port: parseInt(redisPort) },
            database: parseInt(process.env.REDIS_DB) || 0,
            password: process.env.REDIS_PASSWORD || undefined,
          });
          
          // Connect asynchronously; errors are caught and logged
          redisClient.connect().catch((err) => console.error("[SessionManager] Redis connect error:", err));
          this.config.store = new RedisStore(redisClient);
        } catch (err) {
          console.error("[SessionManager] Failed to initialize Redis client:", err);
          this.config.store = store || new MemoryStore();
        }
      }
    } else {
      // Redis disabled or missing config, use provided store or default to Memory
      this.config.store = store || new MemoryStore();
    }

    // Set up periodic cleanup for MemoryStore to prevent memory leaks
    if (this.config.store instanceof MemoryStore) {
      this.cleanup = setInterval(() => this.config.store.prune(), 60000).unref();
    }
  }

  /**
   * Generates the session middleware function.
   * @returns {function} Express/Koa/Aether compatible middleware function.
   */
  middleware() {
    const { enabled, store, maxAge, cookieName, cookieDomain, cookiePath, cookieSecure, cookieSameSite } = this.config;

    // [FIX] If sessions are disabled, actively clear any residual browser cookies and bypass
    if (!enabled) {
      return async (ctx, next) => {
        const sid = getCookieValue(ctx.getHeader("cookie"), cookieName);
        if (sid) {
          // Destroy the cookie in the browser by setting Max-Age=0
          ctx.setHeader(
            "Set-Cookie",
            `${cookieName}=; HttpOnly; ${cookieSecure ? "Secure; " : ""}SameSite=${cookieSameSite}; Max-Age=0; Path=${cookiePath}${cookieDomain ? `; Domain=${cookieDomain}` : ""}`
          );
        }
        return typeof next === "function" ? next() : undefined;
      };
    }

    // Pre-compute the static parts of the Set-Cookie header for performance
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
      
      // 1. Extract Session ID from cookie
      const sid = getCookieValue(ctx.getHeader("cookie"), cookieName);
      
      // 2. Load existing session data from store
      let sessionData = sid ? await store.get(sid) : null;
      let isNew = false;
      
      if (!sessionData) { 
        sessionData = {}; 
        isNew = true; 
      }

      // 3. Create internal state tracker
      const sessionState = { id: sid, data: sessionData, dirty: false };

      // 4. Expose public API to the context
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
          // Clear browser cookie
          ctx.setHeader("Set-Cookie", `${cookieName}=; HttpOnly; ${cookieSecure ? "Secure; " : ""}SameSite=${cookieSameSite}; Max-Age=0; Path=${cookiePath}${cookieDomain ? `; Domain=${cookieDomain}` : ""}`);
        },
        
        regenerate: async () => {
          if (sessionState.id) await store.delete(sessionState.id);
          sessionState.id = genId();
          await store.set(sessionState.id, sessionState.data, maxAge);
          ctx.setHeader("Set-Cookie", `${cookieName}=${sessionState.id}; ${cookieSuffixParts}`);
          sessionState.dirty = false; 
          isNew = false;
        },
        
        getId: () => sessionState.id,
        getAllData: () => ({ ...sessionState.data }),
      };

      // 5. Execute downstream middleware and handle persistence
      try {
        if (typeof next === "function") await next();
      } finally {
        // Only save to store if data was modified
        if (sessionState.dirty) {
          if (isNew || !sessionState.id) {
            sessionState.id = genId();
            ctx.setHeader("Set-Cookie", `${cookieName}=${sessionState.id}; ${cookieSuffixParts}`);
          }
          await store.set(sessionState.id, sessionState.data, maxAge);
        }
      }
    };
  }

  /**
   * Cleans up resources (e.g., stops the MemoryStore pruning interval).
   * Should be called when shutting down the application.
   */
  destroy() { 
    if (this.cleanup) clearInterval(this.cleanup); 
  }
}

export default SessionManager;
