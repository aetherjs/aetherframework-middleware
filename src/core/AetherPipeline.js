/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/core/AetherPipeline
 */

import { EventEmitter } from "events";
import AetherContext from "./AetherContext.js";

// ==========================================
// [V8-OPT] PRE-ALLOCATED STATIC BUFFERS
// ==========================================
const STATIC_RESPONSES = new Map([
  [200, Buffer.from('{"status":"ok"}')],
  [404, Buffer.from('{"error":"Not Found"}')],
  [500, Buffer.from('{"error":"Internal Server Error"}')],
]);

// ==========================================
// [V8-OPT] O(1) HIGH-PERFORMANCE CACHE
// ==========================================
class FastCache {
  constructor(maxSize = 2000) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    return this.cache.get(key);
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear() {
    this.cache.clear();
  }

  get size() { return this.cache.size; }
}

// ==========================================
// [V8-OPT] LOCK-FREE CONTEXT POOL
// ==========================================
class ContextPool {
  constructor(size = 8192) {
    this.pool = new Array(size);
    this.index = size; 
    
    for (let i = 0; i < size; i++) {
      const ctx = new AetherContext(null, null);
      ctx._inPool = true; 
      this.pool[i] = ctx;
    }
  }

  get(req, res) {
    let ctx;
    if (this.index > 0) {
      ctx = this.pool[--this.index];
    } else {
      ctx = new AetherContext(null, null);
      ctx._inPool = false;
    }
    
    // [PERF] Call _reset WITH arguments when ACQUIRING
    if (typeof ctx._reset === 'function') {
      ctx._reset(req, res);
    } else {
      ctx.req = req;
      ctx.res = res;
      ctx.statusCode = 200;
      ctx._terminated = false;
    }
    
    ctx._inPool = false;
    return ctx;
  }

  release(ctx) {
    if (!ctx || ctx._inPool) return; 
    
    if (this.index < this.pool.length) {
      ctx.req = null;
      ctx.res = null;
      ctx._body = null;
      ctx._queryCache = null;
      ctx._ipCache = null;
      ctx.statusCode = 200;
      ctx._terminated = false;
      ctx.params = null;
      ctx.route = null;
      
      // [V8-OPT] Clear headers without breaking Hidden Class
      if (ctx._headersCount > 0) {
        for (let i = 0; i < ctx._headersCount; i++) {
          ctx._headersObj[ctx._headersKeys[i]] = undefined;
        }
        ctx._headersCount = 0;
      } else if (ctx._headers) {
        for (const key in ctx._headers) {
          ctx._headers[key] = undefined;
        }
      }
      
      if (ctx._stateObj) {
        for (const key in ctx._stateObj) {
          ctx._stateObj[key] = undefined;
        }
      }

      ctx._inPool = true;
      this.pool[this.index++] = ctx;
    }
  }
}

const contextPool = new ContextPool(8192);

// ==========================================
// AETHER PIPELINE CORE - STATISTICS REMOVED
// ==========================================
class AetherPipeline extends EventEmitter {
  constructor() {
    super();
    this.middlewares = [];
    this.cache = new FastCache(2000);
    this._compiledChain = null;
  }

  use(middleware) {
    if (typeof middleware !== "function") {
      throw new TypeError("Middleware must be a function");
    }
    this.middlewares.push(middleware);
    this._compiledChain = null; 
    return this;
  }

  _compileChain() {
    if (this._compiledChain) return this._compiledChain;
    
    const middlewares = this.middlewares;
    const len = middlewares.length;
    
    if (len === 0) {
      this._compiledChain = async (ctx) => {};
      return this._compiledChain;
    }
    
    this._compiledChain = async function execute(ctx) {
      async function dispatch(i) {
        if (ctx._terminated || (ctx.res && ctx.res.writableEnded)) return;
        if (i >= len) {
          if (typeof ctx._finalize === 'function') ctx._finalize();
          return;
        }
        
        const mw = middlewares[i];
        await mw(ctx, function next() {
          return dispatch(i + 1);
        });
      }
      
      await dispatch(0);
    };
    
    return this._compiledChain;
  }

  async handle(request, response) {
    const url = request.url;
    const method = request.method;

    // 1. [V8-OPT] Ultra-fast cache check without statistics
    if (method === 'GET') {
      const cached = this.cache.get(url);
      if (cached) {
        const socket = response.socket;
        if (socket && !socket.destroyed) {
           socket.cork();
           response.writeHead(cached.status, cached.headers);
           response.end(cached.buffer);
           socket.uncork();
        }
        return;
      }
    }
    

    // 2. Get context from pool
    const ctx = contextPool.get(request, response);

    try {
      // 3. Execute middleware chain
      const chain = this._compileChain();
      await chain(ctx);

      // 4. [CRITICAL] Cache GET responses BEFORE checking writableEnded
      if (method === 'GET' && ctx.statusCode === 200 && ctx._body) {
        this._cacheResponse(url, ctx);
      }

      // 5. Send response if not already sent by the middleware chain
      if (!ctx._terminated && !response.headersSent) {
        this._sendResponse(ctx);
      }

    } catch (error) {
      if (!response.headersSent) {
        try {
          const socket = response.socket;
          if (socket && !socket.destroyed) {
             socket.cork();
             response.writeHead(500, [
               "Content-Type", "application/json; charset=utf-8",
               "Content-Length", String(STATIC_RESPONSES.get(500).length),
               "Connection", "keep-alive"
             ]);
             response.end(STATIC_RESPONSES.get(500));
             socket.uncork();
          }
        } catch (e) {}
      }
    } finally {
      contextPool.release(ctx);
    }
  }

  _sendResponse(ctx) {
    const response = ctx.res;
    if (!response || response.headersSent) return;

    const statusCode = ctx.statusCode || 200;
    let body = ctx._body;

    const rawHeaders = ["Connection", "keep-alive"];
    const lowerKeys = new Set(["connection"]);

    if (ctx._headersCount > 0) {
      for (let i = 0; i < ctx._headersCount; i++) {
        const key = ctx._headersKeys[i];
        const val = ctx._headersObj[key];
        if (val !== undefined) {
          rawHeaders.push(key, String(val));
          lowerKeys.add(key.toLowerCase());
        }
      }
    } else if (ctx._headers) {
      for (const key in ctx._headers) {
        const val = ctx._headers[key];
        if (val !== undefined) {
          rawHeaders.push(key, String(val));
          lowerKeys.add(key.toLowerCase());
        }
      }
    }

    if (!lowerKeys.has("content-type")) {
      rawHeaders.push("Content-Type", "application/json; charset=utf-8");
    }

    if (body !== undefined && body !== null) {
      const bodyStr = typeof body === 'string' ? body : 
                      Buffer.isBuffer(body) ? body : 
                      JSON.stringify(body);
                      
      const bodyBuffer = Buffer.isBuffer(bodyStr) ? bodyStr : Buffer.from(bodyStr);
      rawHeaders.push("Content-Length", String(bodyBuffer.length));
      
      const socket = response.socket;
      if (socket) socket.cork();
      response.writeHead(statusCode, rawHeaders);
      response.end(bodyBuffer);
      if (socket) socket.uncork();
    } else {
      rawHeaders.push("Content-Length", "0");
      const socket = response.socket;
      if (socket) socket.cork();
      response.writeHead(statusCode, rawHeaders);
      response.end();
      if (socket) socket.uncork();
    }

    ctx._terminated = true;
  }

  _cacheResponse(url, ctx) {
    let bodyBuffer;
    const body = ctx._body;
    
    if (Buffer.isBuffer(body)) {
      bodyBuffer = body;
    } else if (typeof body === 'string') {
      bodyBuffer = Buffer.from(body);
    } else {
      bodyBuffer = Buffer.from(JSON.stringify(body));
    }

    const rawHeaders = ["Connection", "keep-alive"];
    const lowerKeys = new Set(["connection"]);

    if (ctx._headersCount > 0) {
      for (let i = 0; i < ctx._headersCount; i++) {
        const key = ctx._headersKeys[i];
        const val = ctx._headersObj[key];
        if (val !== undefined) {
          rawHeaders.push(key, String(val));
          lowerKeys.add(key.toLowerCase());
        }
      }
    } else if (ctx._headers) {
       for (const key in ctx._headers) {
        const val = ctx._headers[key];
        if (val !== undefined) {
          rawHeaders.push(key, String(val));
          lowerKeys.add(key.toLowerCase());
        }
      }
    }

    if (!lowerKeys.has("content-type")) {
      rawHeaders.push("Content-Type", "application/json; charset=utf-8");
    }
    rawHeaders.push("Content-Length", String(bodyBuffer.length));

    this.cache.set(url, {
      headers: rawHeaders,
      status: ctx.statusCode || 200,
      buffer: bodyBuffer
    });
  }



  clearCache() {
    this.cache.clear();
  }

  useRouter(router) {
    return this.use(router.middleware());
  }
}

export default AetherPipeline;
