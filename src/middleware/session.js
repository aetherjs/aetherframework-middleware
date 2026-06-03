/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/middleware/session
 */

import crypto from "crypto";

//Ultimate optimization: Use the most primitive, zero object allocation for-loop for single-point cookie lookup, reducing GC overhead to absolute zero
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

//Abandon long UUID, use 16-byte high-performance hexadecimal ID, shorten cookie length, reduce network and compression middleware overhead
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

export class SessionManager {
  constructor(options = {}) {
    const { store, ...restOptions } = options;
    this.config = {
      enabled: process.env.SESSION_ENABLED !== "false",
      maxAge: parseInt(process.env.SESSION_MAX_AGE) || 86400000,
      cookieName: process.env.SESSION_COOKIE_NAME || "aether_sid",
      ...restOptions,
    };
    this.config.store =
      store && typeof store === "object" ? store : new MemoryStore();
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

    const { store, maxAge, cookieName } = this.config;
    const cookieSuffix = `; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(maxAge / 1000)}; Path=/`;

    return async (ctx, next) => {
      ctx.state ??= {};

      const sid = getCookieValue(ctx.getHeader("cookie"), cookieName);
      let sessionData = sid ? await store.get(sid) : null;

      // 🚀 Strategy adjustment: If not obtained, first give an empty object, never write to storage early, never set cookie early
      let isNew = false;
      if (!sessionData) {
        sessionData = {};
        isNew = true;
      }

      const sessionState = { id: sid, data: sessionData, dirty: false };

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
          ctx.setHeader(
            "Set-Cookie",
            `${cookieName}=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`,
          );
        },
        regenerate: async () => {
          if (sessionState.id) await store.delete(sessionState.id);
          sessionState.id = genId();
          await store.set(sessionState.id, sessionState.data, maxAge);
          ctx.setHeader(
            "Set-Cookie",
            `${cookieName}=${sessionState.id}${cookieSuffix}`,
          );
          sessionState.dirty = false;
          isNew = false;
        },
      };

      //Use the most reliable and well-isolated try...finally to ensure pipeline smoothness, while strictly limiting persistence logic to the "actually modified" checkpoint
      try {
        if (next) {
          next.next ? await next.next() : await next();
        }
      } finally {
        if (sessionState.dirty) {
          // If it's a new session and the route has written data, only now generate the ID and issue the cookie
          if (isNew || !sessionState.id) {
            sessionState.id = genId();
            ctx.setHeader(
              "Set-Cookie",
              `${cookieName}=${sessionState.id}${cookieSuffix}`,
            );
          }
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
