 /**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/core/AetherPipeline
 */
import { EventEmitter } from "events";
import AetherContext from "./AetherContext.js";

const STATIC_RESPONSES = new Map([
  [200, Buffer.from(JSON.stringify({ status: "ok" }))],
  [404, Buffer.from(JSON.stringify({ error: "Not Found" }))],
  [500, Buffer.from(JSON.stringify({ error: "Internal Server Error" }))],
]);

const CONTEXT_POOL = [];
const IN_POOL_CHECK = new Set(); 
const CONTEXT_POOL_SIZE = 4096;

class AetherPipeline extends EventEmitter {
  constructor() {
    super();
    this._middlewares = [];
    this._compiled = null;
    this._compiledSync = null;
    this._cache = new Map();
    this._cacheMaxSize = 1000;
    this.enableMetrics = false;

    this._stats = {
      totalRequests: 0,
      averageLatency: 0,
      errorCount: 0,
      cacheHits: 0,
      cacheMisses: 0,
      poolHits: 0,
      poolMisses: 0,
    };

    this._initObjectPools();
  }

  _initObjectPools() {
    for (let i = 0; i < CONTEXT_POOL_SIZE; i++) {
      const ctx = new AetherContext(null, null);
      CONTEXT_POOL.push(ctx);
      IN_POOL_CHECK.add(ctx);
    }
  }

  _getContext(request, response) {
    if (CONTEXT_POOL.length > 0) {
      const context = CONTEXT_POOL.pop();
      IN_POOL_CHECK.delete(context);
      context._reset(request, response);
      if (this.enableMetrics) this._stats.poolHits++;
      return context;
    }
    if (this.enableMetrics) this._stats.poolMisses++;
    return new AetherContext(request, response);
  }

  _returnContext(context) {
    if (!context || IN_POOL_CHECK.has(context)) return;

    if (CONTEXT_POOL.length < CONTEXT_POOL_SIZE) {
      context.req = null;
      context.res = null;
      context._body = null;

      // Safely clean up Headers
      if (context._headers && typeof context._headers.clear === "function") {
        context._headers.clear();
      } else {
        context._headers = null;
      }

      CONTEXT_POOL.push(context);
      IN_POOL_CHECK.add(context);
    }
  }

  use(middleware) {
    if (typeof middleware !== "function") {
      throw new TypeError("Middleware must be a function");
    }
    this._middlewares.push(middleware);
    this._compiled = null;
    this._compiledSync = null;
    return this;
  }

  /**
   *Core Control 1: Standard V8-level high-concurrency asynchronous onion model compiler
   * Ensure perfect timing wait chain, absolutely prevent asynchronous middleware (like CORS/security headers) from experiencing asynchronous drift
   */
  compile() {
    if (this._compiled) return this._compiled;
    const middlewares = this._middlewares;
    const len = middlewares.length;

    this._compiled = async function executePipeline(context) {
      async function dispatch(i) {
        // 1. Safety boundary check: If context is terminated or connection is disconnected, return directly
        if (
          context.isTerminated() ||
          (context._response && context._response.writableEnded)
        ) {
          if (context._finalize) context._finalize();
          return;
        }

        // 2. Pipeline end: Safely trigger final _finalize
        if (i >= len) {
          if (context._finalize) context._finalize();
          return;
        }

        const mw = middlewares[i];

        // 3. Strictly bind current middleware with next subsequent chain's asynchronous timing
        await mw(context, function next() {
          return dispatch(i + 1);
        });
      }

      // 🚀 Start the first middleware and strictly wait for the entire chain lifecycle to end
      await dispatch(0);
    };

    return this._compiled;
  }

  _compileSync() {
    if (this._compiledSync) return this._compiledSync;
    const middlewares = this._middlewares;
    const len = middlewares.length;

    const allSync = middlewares.every((mw) => {
      const funcStr = mw.toString();
      return (
        !funcStr.includes("async ") &&
        !funcStr.includes(".then") &&
        !funcStr.includes("await ")
      );
    });

    if (!allSync) return null;

    this._compiledSync = function executePipelineSync(context) {
      for (let i = 0; i < len; i++) {
        middlewares[i](context, () => {});
        if (context.isTerminated() || context.res?.writableEnded) return;
      }
      if (context._finalize) context._finalize();
    };

    return this._compiledSync;
  }

  async handle(request, response) {
    this._stats.totalRequests++;
    const url = request.url;
    const method = request.method;

    // 1. Root high-speed channel (with fallback CORS headers)
    if (method === "GET" && url === "/") {
      const socket = response.socket;
      if (socket) socket.cork();
      response.writeHead(200, [
        "Content-Type",
        "application/json; charset=utf-8",
        "Content-Length",
        "15",
        "Connection",
        "keep-alive",
        "Access-Control-Allow-Origin",
        "*",
      ]);
      response.end(STATIC_RESPONSES.get(200));
      if (socket) socket.uncork();
      return { cacheHit: true, static: true };
    }

    // 2. Cache route hit
    let methodCache = this._cache.get(method);
    if (!methodCache) {
      methodCache = new Map();
      this._cache.set(method, methodCache);
    }
    const cached = methodCache.get(url);

    if (cached) {
      if (this.enableMetrics) this._stats.cacheHits++;
      const socket = response.socket;
      if (socket) socket.cork();
      response.writeHead(cached.status, cached.headers);
      response.end(cached.buffer);
      if (socket) socket.uncork();
      return { cacheHit: true };
    }

    if (this.enableMetrics) this._stats.cacheMisses++;

    // 3. Context construction and core scheduling
    const context = this._getContext(request, response);

    try {
      //Core Control 2: Prioritize reading cached synchronous pipeline to avoid frequent character scanning causing CPU spikes under high concurrency
      const pipelineSync = this._compiledSync || this._compileSync();

      if (pipelineSync) {
        pipelineSync(context);
      } else {
        // Strictly lock asynchronous middleware timing
        await this.compile()(context);
      }

      // 4. Dynamically capture all response headers, merge and store in high-speed cache
      if (method === "GET" && response && response.statusCode < 400) {
        this._setResponseCache(methodCache, url, context, response);
      }

      this._returnContext(context);
      return { cacheHit: false };
    } catch (error) {
      if (this.enableMetrics) this._stats.errorCount++;
      try {
        if (response && !response.headersSent) {
          response.writeHead(500, [
            "Content-Type",
            "application/json; charset=utf-8",
            "Access-Control-Allow-Origin",
            "*",
          ]);
          response.end(STATIC_RESPONSES.get(500));
        }
      } catch (e) {}
      if (context) this._returnContext(context);
      throw error;
    }
  }

  /**
   *Core Control 3: Ultimate comprehensive defense extraction algorithm —— Intercept multi-source Headers without blind spots
   */
  _setResponseCache(methodCache, url, context, response) {
    // Establish a standard flat array, native two-element storage format is most efficient
    const rawHeaders = ["Connection", "keep-alive"];
    const lowerKeys = new Set(["connection"]);

    // ==========================================
    // Strategy A: Forcefully synchronously extract AetherContext's high-performance private storage
    // ==========================================
    if (context && context._headersCount > 0) {
      for (let i = 0; i < context._headersCount; i++) {
        const key = context._headersKeys[i];
        const val = context._headersObj[key];
        if (val !== undefined && key) {
          const kLower = key.toLowerCase();
          if (!lowerKeys.has(kLower)) {
            rawHeaders.push(key, String(val));
            lowerKeys.add(kLower);
          }
        }
      }
    }

    // ==========================================
    // Strategy B: Deep scan various non-standard Context properties that may evolve into generic dictionaries
    // ==========================================
    const potentialDicts = [
      context?._headers,
      context?.headers,
      context?.res?.headers,
    ];
    for (const dict of potentialDicts) {
      if (dict && typeof dict === "object" && !(dict instanceof Set)) {
        for (const key in dict) {
          if (Object.prototype.hasOwnProperty.call(dict, key)) {
            const kLower = key.toLowerCase();
            if (!lowerKeys.has(kLower) && dict[key] !== undefined) {
              rawHeaders.push(key, String(dict[key]));
              lowerKeys.add(kLower);
            }
          }
        }
      }
    }

    // ==========================================
    // Strategy C: Ultimate gap filling: Synchronously capture Node.js native response's standard response headers (security upgraded version)
    // ==========================================
    if (response) {
      // 1. Intercept standard getHeaders() - Standard entry point for most modern Node.js
      if (typeof response.getHeaders === "function") {
        const nodeHeaders = response.getHeaders();
        if (nodeHeaders) {
          for (const key in nodeHeaders) {
            const kLower = key.toLowerCase();
            if (!lowerKeys.has(kLower)) {
              const val = nodeHeaders[key];
              rawHeaders.push(
                key,
                Array.isArray(val) ? val.join(", ") : String(val),
              );
              lowerKeys.add(kLower);
            }
          }
        }
      }

      // 2. Intercept standard getHeaderNames() - As standard supplement for HTTP/2 or special streaming protocols
      if (typeof response.getHeaderNames === "function") {
        const names = response.getHeaderNames();
        if (Array.isArray(names)) {
          for (const key of names) {
            const kLower = key.toLowerCase();
            if (!lowerKeys.has(kLower)) {
              const val = response.getHeader(key);
              if (val !== undefined && val !== null) {
                rawHeaders.push(
                  key,
                  Array.isArray(val) ? val.join(", ") : String(val),
                );
                lowerKeys.add(kLower);
              }
            }
          }
        }
      }

      // 🟢 Removed response._headers detection code that would cause high-version Node.js crashes and deprecation warnings
    }

    // ==========================================
    // Strategy D: Extract Body and convert to high-speed persistent Buffer
    // ==========================================
    let body = context._body || "";
    const buffer = Buffer.isBuffer(body)
      ? body
      : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));

    // Complete length header
    if (!lowerKeys.has("content-length")) {
      rawHeaders.push("Content-Length", String(buffer.length));
    }

    methodCache.set(url, {
      headers: rawHeaders,
      status: context.statusCode || response.statusCode || 200,
      buffer,
      timestamp: Date.now(),
    });

    if (methodCache.size > this._cacheMaxSize) {
      const firstKey = methodCache.keys().next().value;
      methodCache.delete(firstKey);
    }
  }

  getStats() {
    return { ...this._stats, poolSize: CONTEXT_POOL.length };
  }
  clearCache() {
    this._cache.clear();
  }
  precompile() {
    this.compile();
    this._compileSync();
    return this;
  }
}

export default AetherPipeline;
