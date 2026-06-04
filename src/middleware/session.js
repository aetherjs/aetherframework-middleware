/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * @module @aetherframework/middleware/middleware/session
 */

import crypto from "crypto";
import redis from "redis";

// [V8-OPT] Zero allocation cookie lookup
function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return undefined;
  const target = name + "=";
  const len = cookieHeader.length;
  let pos = 0;
  while (pos < len) {
    pos = cookieHeader.indexOf(target, pos);
    if (pos === -1) break;
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

const genId = () => crypto.randomBytes(16).toString("hex");

// ... (MemoryStore and RedisStore remain exactly the same as your original code) ...
class MemoryStore {
  constructor() { this.cache = new Map(); }
  async get(id) { const s = this.cache.get(id); if (!s) return null; if (Date.now() > s.exp) { this.cache.delete(id); return null; } return s.data; }
  async set(id, data, ttl) { this.cache.set(id, { data, exp: Date.now() + ttl }); }
  async delete(id) { this.cache.delete(id); }
  prune() { const now = Date.now(); for (const [k, v] of this.cache) if (now > v.exp) this.cache.delete(k); }
}

class RedisStore {
  constructor(client) { this.client = client; this.prefix = "sess:"; }
  async get(id) { try { const data = await this.client.get(`${this.prefix}${id}`); return data ? JSON.parse(data) : null; } catch (err) { return null; } }
  async set(id, data, ttl) { try { await this.client.setEx(`${this.prefix}${id}`, Math.floor(ttl / 1000), JSON.stringify(data)); } catch (err) {} }
  async delete(id) { try { await this.client.del(`${this.prefix}${id}`); } catch (err) {} }
  prune() {}
}

// [V8-OPT] Safe boolean parser
function isEnvEnabled(key, defaultValue = false) {
  const val = process.env[key];
  if (val === undefined || val === null) return defaultValue;
  if (val === 'true' || val === '1') return true;
  if (val === 'false' || val === '0' || val === '') return false;
  return ['true', '1', 'yes', 'on'].includes(val.toLowerCase().trim());
}

export class SessionManager {
  constructor(options = {}) {
    const { store, ...restOptions } = options;
    
    this.config = {
      // [FIX] Use strict boolean parsing
      enabled: isEnvEnabled('SESSION_ENABLED', false), 
      maxAge: parseInt(process.env.SESSION_MAX_AGE) || 86400000,
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

    if (redisEnabled && redisHost && redisPort) {
      try {
        const redisClient = redis.createClient({
          socket: { host: redisHost, port: parseInt(redisPort) },
          database: parseInt(process.env.REDIS_DB) || 0,
          password: process.env.REDIS_PASSWORD || undefined,
        });
        redisClient.connect().catch((err) => console.error("[SessionManager] Redis connect error:", err));
        this.config.store = new RedisStore(redisClient);
      } catch (err) {
        this.config.store = store || new MemoryStore();
      }
    } else {
      this.config.store = store || new MemoryStore();
    }

    if (this.config.store instanceof MemoryStore) {
      this.cleanup = setInterval(() => this.config.store.prune(), 60000).unref();
    }
  }

  middleware() {
    const { enabled, store, maxAge, cookieName, cookieDomain, cookiePath, cookieSecure, cookieSameSite } = this.config;

    // [FIX] If disabled, actively clear the browser's residual cookie and bypass
    if (!enabled) {
      return async (ctx, next) => {
        // Check if browser sent the residual cookie
        const sid = getCookieValue(ctx.getHeader("cookie"), cookieName);
        if (sid) {
          // Actively destroy the cookie in the browser by setting Max-Age=0
          ctx.setHeader(
            "Set-Cookie",
            `${cookieName}=; HttpOnly; ${cookieSecure ? "Secure; " : ""}SameSite=${cookieSameSite}; Max-Age=0; Path=${cookiePath}${cookieDomain ? `; Domain=${cookieDomain}` : ""}`
          );
        }
        return typeof next === "function" ? next() : undefined;
      };
    }

    const cookieSuffixParts = [
      "HttpOnly", cookieSecure ? "Secure" : "", `SameSite=${cookieSameSite}`,
      `Max-Age=${Math.floor(maxAge / 1000)}`, `Path=${cookiePath}`, cookieDomain ? `Domain=${cookieDomain}` : ""
    ].filter(Boolean).join("; ");

    return async (ctx, next) => {
      ctx.state ??= {};
      const sid = getCookieValue(ctx.getHeader("cookie"), cookieName);
      let sessionData = sid ? await store.get(sid) : null;
      let isNew = false;
      if (!sessionData) { sessionData = {}; isNew = true; }

      const sessionState = { id: sid, data: sessionData, dirty: false };

      ctx.session = {
        get: (key) => sessionState.data[key],
        set: (key, val) => { sessionState.data[key] = val; sessionState.dirty = true; },
        delete: (key) => { delete sessionState.data[key]; sessionState.dirty = true; },
        clear: () => { sessionState.data = {}; sessionState.dirty = true; },
        destroy: async () => {
          if (sessionState.id) await store.delete(sessionState.id);
          sessionState.id = null; sessionState.data = {}; sessionState.dirty = false;
          ctx.setHeader("Set-Cookie", `${cookieName}=; HttpOnly; ${cookieSecure ? "Secure; " : ""}SameSite=${cookieSameSite}; Max-Age=0; Path=${cookiePath}${cookieDomain ? `; Domain=${cookieDomain}` : ""}`);
        },
        regenerate: async () => {
          if (sessionState.id) await store.delete(sessionState.id);
          sessionState.id = genId();
          await store.set(sessionState.id, sessionState.data, maxAge);
          ctx.setHeader("Set-Cookie", `${cookieName}=${sessionState.id}; ${cookieSuffixParts}`);
          sessionState.dirty = false; isNew = false;
        },
        getId: () => sessionState.id,
        getAllData: () => ({ ...sessionState.data }),
      };

      try {
        if (typeof next === "function") await next();
      } finally {
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

  destroy() { if (this.cleanup) clearInterval(this.cleanup); }
}

export default SessionManager;
