/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/core/AetherRouter
 */

import { EventEmitter } from "events";

// [V8-OPT] Pre-allocated frozen objects to prevent heap allocation in hot paths.
// V8 handles frozen objects as constants, avoiding memory allocation entirely.
const EMPTY_PARAMS = Object.freeze({});
const EMPTY_QUERY = Object.freeze({});

/**
 * [V8-OPT] Stateful HandlerChain for 6+ handlers.
 * Replaces deep recursive closures. V8 JIT compiles prototype methods and 
 * stateful loops much better than nested closure compositions (like Koa's compose).
 */
class HandlerChain {
  constructor(context, handlers) {
    this.context = context;
    this.handlers = handlers;
    this.index = 0;
    this.len = handlers.length;
    // [V8-OPT] Bind once per request. V8 optimizes bound prototype methods heavily.
    this.nextBound = this.next.bind(this);
  }

  async next() {
    const ctx = this.context;
    // [V8-OPT] Fast-path exit. Direct property access is faster than method calls.
    if (this.index >= this.len || ctx.isTerminated()) return;
    
    const handler = this.handlers[this.index++];
    try {
      await handler(ctx, this.nextBound);
    } catch (error) {
      // [V8-OPT] Delegate to cold-path to prevent deoptimization of the hot loop.
      this._handleError(error);
    }
  }

  _handleError(error) {
    console.error(`[AetherRouter Error]`, error);
    const ctx = this.context;
    if (!ctx.isTerminated()) {
      ctx.setStatus(500).json({ 
        success: false, 
        error: "Internal Server Error", 
        message: error.message 
      });
    }
  }
}

/**
 * [V8-OPT] Zero-Allocation Query Parser.
 * Mimics C++ linear scanning. Avoids String.split() to prevent intermediate array creation.
 */
class JITQueryParser {
  parse(search) {
    if (!search || search.length === 0) return EMPTY_QUERY;

    const query = {};
    let i = 0;
    const len = search.length;
    
    while (i < len) {
      let ampIndex = search.indexOf('&', i);
      if (ampIndex === -1) ampIndex = len;
      
      const eqIndex = search.indexOf('=', i);
      
      if (eqIndex !== -1 && eqIndex < ampIndex) {
        const rawKey = search.substring(i, eqIndex);
        const rawValue = search.substring(eqIndex + 1, ampIndex);
        const key = decodeURIComponent(rawKey);
        const value = decodeURIComponent(rawValue);
        
        // [V8-OPT] Fast array notation check without endsWith() allocation.
        const kLen = key.length;
        if (kLen > 2 && key.charCodeAt(kLen - 2) === 91 && key.charCodeAt(kLen - 1) === 93) {
          const arrayKey = key.slice(0, -2);
          let arr = query[arrayKey];
          if (!arr) { arr = []; query[arrayKey] = arr; }
          arr.push(value);
        } else {
          query[key] = value;
        }
      } else if (i < ampIndex) {
        query[decodeURIComponent(search.substring(i, ampIndex))] = "";
      }
      
      i = ampIndex + 1;
    }
    return query;
  }
}

/**
 * [V8-OPT] Optimized Handler Executor with Unrolled Chains.
 * Replaces dynamic loops with hardcoded, V8-friendly unrolled executors for small chains.
 */
class JITHandlerExecutor {
  getExecutor(handlers) {
    const len = handlers.length;
    if (len === 0) return this._exec0;
    if (len === 1) return this._exec1;
    if (len === 2) return this._exec2;
    if (len === 3) return this._exec3;
    if (len === 4) return this._exec4;
    if (len === 5) return this._exec5;
    
    // For 6+ handlers, use the stateful HandlerChain class.
    return async (context) => {
      const chain = new HandlerChain(context, handlers);
      await chain.next();
    };
  }

  // [V8-OPT] Cold path error handler
  static _handleError(context, error) {
    console.error(`[AetherRouter Error]`, error);
    if (!context.isTerminated()) {
      context.setStatus(500).json({ success: false, error: "Internal Server Error", message: error.message });
    }
  }

  async _exec0(ctx) {}

  async _exec1(ctx) {
    if (ctx.isTerminated()) return;
    try { await this[0](ctx, async () => {}); } 
    catch (e) { JITHandlerExecutor._handleError(ctx, e); }
  }

  async _exec2(ctx) {
    if (ctx.isTerminated()) return;
    try { 
      await this[0](ctx, async () => { 
        if (!ctx.isTerminated()) await this[1](ctx, async () => {}); 
      }); 
    } catch (e) { JITHandlerExecutor._handleError(ctx, e); }
  }

  async _exec3(ctx) {
    if (ctx.isTerminated()) return;
    try { 
      await this[0](ctx, async () => { 
        if (!ctx.isTerminated()) await this[1](ctx, async () => { 
          if (!ctx.isTerminated()) await this[2](ctx, async () => {}); 
        }); 
      }); 
    } catch (e) { JITHandlerExecutor._handleError(ctx, e); }
  }

  async _exec4(ctx) {
    if (ctx.isTerminated()) return;
    try { 
      await this[0](ctx, async () => { 
        if (!ctx.isTerminated()) await this[1](ctx, async () => { 
          if (!ctx.isTerminated()) await this[2](ctx, async () => { 
            if (!ctx.isTerminated()) await this[3](ctx, async () => {}); 
          }); 
        }); 
      }); 
    } catch (e) { JITHandlerExecutor._handleError(ctx, e); }
  }

  async _exec5(ctx) {
    if (ctx.isTerminated()) return;
    try { 
      await this[0](ctx, async () => { 
        if (!ctx.isTerminated()) await this[1](ctx, async () => { 
          if (!ctx.isTerminated()) await this[2](ctx, async () => { 
            if (!ctx.isTerminated()) await this[3](ctx, async () => { 
              if (!ctx.isTerminated()) await this[4](ctx, async () => {}); 
            }); 
          }); 
        }); 
      }); 
    } catch (e) { JITHandlerExecutor._handleError(ctx, e); }
  }
}

/**
 * AetherRouter - V8-Optimized High-Performance Router
 */
class AetherRouter extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // [V8-OPT] Map for O(1) static route lookups. V8's C++ hash map is vastly superior to array iteration.
    this.staticRoutes = new Map(); 
    // [V8-OPT] Flat array for dynamic routes. Iteration is required for regex matching.
    this.dynamicRoutes = []; 
    
    this.globalMiddlewares = [];
    this.prefixMiddlewares = [];
    
    this.prefix = options.prefix || ""; 
    this.version = options.version || ""; 
    
    this.routeCache = new Map();
    this.cacheMaxSize = options.cacheMaxSize || 2000; 
    
    this.jitQueryParser = new JITQueryParser();
    this.jitExecutor = new JITHandlerExecutor();
  }

  // ==========================================
  // [V8-OPT] PROTOTYPE-BOUND HTTP METHODS
  // ==========================================
  // Defining methods directly on the prototype guarantees they exist instantly,
  // bypassing constructor execution risks. It also allows V8 to share the 
  // function references across all instances (Monomorphic Hidden Classes).

  get(path, ...handlers) { return this._addRoute("GET", path, handlers); }
  post(path, ...handlers) { return this._addRoute("POST", path, handlers); }
  put(path, ...handlers) { return this._addRoute("PUT", path, handlers); }
  delete(path, ...handlers) { return this._addRoute("DELETE", path, handlers); }
  patch(path, ...handlers) { return this._addRoute("PATCH", path, handlers); }
  options(path, ...handlers) { return this._addRoute("OPTIONS", path, handlers); }
  head(path, ...handlers) { return this._addRoute("HEAD", path, handlers); }
  all(path, ...handlers) { return this._addRoute("ANY", path, handlers); }

  _addRoute(method, path, handlers) {
    if (handlers.length === 0) throw new Error(`Route ${method} ${path} must have at least one handler`);
    
    const fullPath = this._buildPath(path);
    const isStatic = fullPath.indexOf(':') === -1 && fullPath.indexOf('*') === -1;
    
    // [V8-OPT] Strict monomorphic object shape. Always initialize properties in the exact same order.
    const route = {
      method: method === "ANY" ? null : method,
      path: fullPath,
      isStatic: isStatic,
      handlers: this._wrapHandlers(handlers),
      regex: isStatic ? null : this._pathToRegex(fullPath),
      paramNames: isStatic ? [] : this._extractParamNames(fullPath)
    };
    
    if (isStatic) {
      // [V8-OPT] O(1) insertion and lookup for static routes.
      const key = `${route.method || 'ANY'}:${fullPath}`;
      this.staticRoutes.set(key, route);
    } else {
      this.dynamicRoutes.push(route);
    }
    
    this.emit("route:added", { method, path: fullPath, handlers: handlers.length });
    return this;
  }

  _buildPath(path) {
    let fullPath = "";
    if (this.version) fullPath += `/v${this.version.replace(/[^0-9.]/g, "")}`;
    if (this.prefix) fullPath += `/${this.prefix.replace(/^\/|\/$/g, "")}`;
    fullPath += `/${path.replace(/^\/|\/$/g, "")}`;
    return fullPath.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  }

  _pathToRegex(path) {
    const escapedPath = path.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const pattern = escapedPath
      .replace(/\\:(\w+)/g, "([^/]+)") // Positional captures are faster than named captures in V8
      .replace(/\\\*(\w+)?/g, "(.*)") 
      .replace(/\\\$([^)]+)\\\$/g, "(?:$1)") 
      .replace(/\\\?/g, "\\?"); 
    return new RegExp(`^${pattern}$`);
  }

  _extractParamNames(path) {
    const paramNames = [];
    const paramPattern = /:(\w+)/g;
    const wildcardPattern = /\*(\w+)?/g;
    let match;
    while ((match = paramPattern.exec(path)) !== null) paramNames.push(match[1]);
    while ((match = wildcardPattern.exec(path)) !== null) if (match[1]) paramNames.push(match[1]);
    return paramNames;
  }

  _wrapHandlers(handlers) {
    for (let i = 0; i < handlers.length; i++) {
      if (typeof handlers[i] !== "function") {
        throw new TypeError(`Route handler must be a function, got ${typeof handlers[i]} at position ${i}`);
      }
    }
    return handlers;
  }

  group(prefix, callback) {
    const router = new AetherRouter({ prefix: `${this.prefix}/${prefix}`.replace(/\/+/g, "/"), version: this.version });
    router.globalMiddlewares = this.globalMiddlewares.slice();
    router.prefixMiddlewares = this.prefixMiddlewares.slice();
    callback(router);
    
    router.staticRoutes.forEach((route, key) => this.staticRoutes.set(key, route));
    const dLen = router.dynamicRoutes.length;
    for (let i = 0; i < dLen; i++) this.dynamicRoutes.push(router.dynamicRoutes[i]);
    return this;
  }

  version(version, callback) {
    const router = new AetherRouter({ prefix: this.prefix, version: version });
    router.globalMiddlewares = this.globalMiddlewares.slice();
    router.prefixMiddlewares = this.prefixMiddlewares.slice();
    callback(router);
    
    router.staticRoutes.forEach((route, key) => this.staticRoutes.set(key, route));
    const dLen = router.dynamicRoutes.length;
    for (let i = 0; i < dLen; i++) this.dynamicRoutes.push(router.dynamicRoutes[i]);
    return this;
  }

  use(...args) {
    if (args.length === 0) return this;

    // [FIX] Corrected typeof check. args is an array, so we must check args[0].
    if (typeof args[0] === 'function' && typeof args[1] === 'string') {
      const path = args[1];
      const middlewares = [args[0], ...args.slice(2)];
      args = [path, ...middlewares];
    }

    if (typeof args[0] === 'string') {
      const path = args[0]; 
      const middlewares = args.slice(1);
      
      for (let i = 0; i < middlewares.length; i++) {
        let mw = middlewares[i];
        if (typeof mw !== "function") {
          if (mw && typeof mw.middleware === 'function') middlewares[i] = mw.middleware();
          else throw new TypeError(`Middleware for path "${path}" must be a function, got ${typeof mw}`);
        }
      }
      
      const normalizedPath = path === '/' ? '/' : path.replace(/\/+$/, '');
      const escapedPath = normalizedPath.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const prefixRegex = normalizedPath === '/' ? null : new RegExp(`^${escapedPath}(?=/|$|\\?)`, 'i');
      
      const wrappedMiddlewares = new Array(middlewares.length);
      for (let i = 0; i < middlewares.length; i++) {
        const mw = middlewares[i];
        wrappedMiddlewares[i] = async (ctx, next) => {
          if (!prefixRegex) return mw(ctx, next);
          const originalUrl = ctx.url;
          const originalPath = ctx.path; 
          if (prefixRegex.test(originalUrl)) {
            let newUrl = originalUrl.replace(prefixRegex, '');
            if (newUrl.charCodeAt(0) !== 47) newUrl = '/' + newUrl; // 47 is '/'
            ctx.url = newUrl;
            try { 
              if ('path' in ctx) ctx.path = newUrl.split('?')[0]; 
              await mw(ctx, next); 
            } finally {
              ctx.url = originalUrl;
              if ('path' in ctx) ctx.path = originalPath;
            }
          } else { await next(); }
        };
      }

      if (normalizedPath === '/') {
        this.globalMiddlewares.push(...wrappedMiddlewares);
      } else {
        this.prefixMiddlewares.push({ path: normalizedPath, handlers: wrappedMiddlewares });
      }
    } else {
      for (let i = 0; i < args.length; i++) {
        if (typeof args[i] !== "function") throw new TypeError(`Global middleware must be a function, got ${typeof args[i]}`);
      }
      this.globalMiddlewares.push(...args);
    }
    return this;
  }

  /**
   * [V8-OPT] The absolute hot path. 
   * Optimized for monomorphic returns, zero-allocation parsing, and O(1) static lookups.
   */
  match(method, url) {
    // 1. Fast URL split (No regex, native indexOf)
    const qIndex = url.indexOf("?");
    const pathname = qIndex === -1 ? url : url.substring(0, qIndex);
    const search = qIndex === -1 ? null : url.substring(qIndex + 1);
    
    const cacheKey = method + ":" + pathname; // String concat is heavily optimized in V8

    // 2. Pure Cache Hit
    const cached = this.routeCache.get(cacheKey);
    if (cached !== undefined) {
      const route = cached.route;
      // [CRITICAL FIX] Never cache params for dynamic routes! Extract them on the fly to prevent cache poisoning.
      const params = route && !route.isStatic ? this._extractParams(route, pathname) : EMPTY_PARAMS;
      
      return {
        route: route,
        params: params || EMPTY_PARAMS,
        query: search ? this.jitQueryParser.parse(search) : EMPTY_QUERY,
        handlers: cached.handlers
      };
    }

    // 3. Collect middlewares (Pre-allocate array capacity hint via initial push)
    const applicableMiddlewares = [];
    const gLen = this.globalMiddlewares.length;
    for (let i = 0; i < gLen; i++) applicableMiddlewares.push(this.globalMiddlewares[i]);
    
    const pLen = this.prefixMiddlewares.length;
    for (let i = 0; i < pLen; i++) {
      const mw = this.prefixMiddlewares[i];
      const mwPath = mw.path;
      const mwPathSlash = mwPath.endsWith('/') ? mwPath : mwPath + '/';
      if (pathname === mwPath || pathname.startsWith(mwPathSlash)) {
        const hLen = mw.handlers.length;
        for (let j = 0; j < hLen; j++) applicableMiddlewares.push(mw.handlers[j]);
      }
    }

    let matchedRoute = null;

    // 4. [V8-OPT] Static Route Fast-Path O(1) Lookup
    matchedRoute = this.staticRoutes.get(method + ":" + pathname);
    if (!matchedRoute) {
      matchedRoute = this.staticRoutes.get("ANY:" + pathname);
    }

    // 5. Fallback to Dynamic Routes (Regex)
    if (!matchedRoute) {
      const dLen = this.dynamicRoutes.length;
      for (let i = 0; i < dLen; i++) {
        const route = this.dynamicRoutes[i];
        if (route.method !== null && route.method !== method) continue;
        
        // [V8-OPT] RegExp.exec is slightly faster than String.match when we don't need the string context.
        const match = route.regex.exec(pathname);
        if (match) {
          matchedRoute = route;
          // Temporarily store match result to avoid re-running regex in _extractParams
          matchedRoute._lastMatch = match; 
          break;
        }
      }
    }

    // 6. Build and Cache handler chain
    if (matchedRoute) {
      const finalHandlers = applicableMiddlewares.concat(matchedRoute.handlers);
      
      if (this.routeCache.size >= this.cacheMaxSize) this.routeCache.clear();
      // [CRITICAL FIX] Cache the route and handlers, NOT the extracted params.
      this.routeCache.set(cacheKey, { route: matchedRoute, handlers: finalHandlers });

      const params = matchedRoute.isStatic ? EMPTY_PARAMS : this._extractParams(matchedRoute, pathname, matchedRoute._lastMatch);
      return { 
        route: matchedRoute, 
        params: params, 
        query: search ? this.jitQueryParser.parse(search) : EMPTY_QUERY, 
        handlers: finalHandlers 
      };
    }
    
    if (applicableMiddlewares.length > 0) {
      if (this.routeCache.size >= this.cacheMaxSize) this.routeCache.clear();
      this.routeCache.set(cacheKey, { route: null, handlers: applicableMiddlewares });
      
      return { 
        route: null, 
        params: EMPTY_PARAMS, 
        query: search ? this.jitQueryParser.parse(search) : EMPTY_QUERY, 
        handlers: applicableMiddlewares 
      };
    }
    
    return null;
  }

  /**
   * [V8-OPT] Fast param extraction using pre-compiled regex and indexed access.
   */
  _extractParams(route, pathname, existingMatch) {
    const match = existingMatch || route.regex.exec(pathname);
    if (!match) return EMPTY_PARAMS;
    
    const params = {};
    const names = route.paramNames;
    const len = names.length;
    for (let i = 0; i < len; i++) {
      params[names[i]] = match[i + 1];
    }
    return params;
  }

  middleware() {
    return async (context, next) => {
      const match = this.match(context.method, context.url);
      
      if (match) {
        context.params = match.params;
        context.route = match.route;
        
        // [FIX] AetherContext defines 'query' as a getter-only property.
        // Direct assignment (context.query = ...) throws a TypeError in strict mode.
        // We must use the framework's setState() to update the underlying state safely.
        if (typeof context.setState === "function") {
          context.setState("query", match.query);
        } else {
          try { context.query = match.query; } catch (e) { /* Ignore getter-only error */ }
        }
        
        if (match.handlers && match.handlers.length > 0) {
          // [V8-OPT] Fetch the optimal unrolled executor for the handler count
          const executor = this.jitExecutor.getExecutor(match.handlers);
          await executor.call(match.handlers, context);
        } else if (typeof next === "function") {
          await next();
        }
        
        if (!context.isTerminated() && !match.route && typeof next === "function") {
          await next();
        }
      } else if (typeof next === "function") {
        await next();
      } else {
        context.setStatus(404).json({ 
          success: false, 
          error: "Not Found", 
          message: `Route ${context.method} ${context.url} not found` 
        });
      }
    };
  }

  getRoutes() {
    const routes = [];
    this.staticRoutes.forEach(r => routes.push({ method: r.method || "ALL", path: r.path, type: 'static' }));
    const dLen = this.dynamicRoutes.length;
    for (let i = 0; i < dLen; i++) {
      const r = this.dynamicRoutes[i];
      routes.push({ method: r.method || "ALL", path: r.path, type: 'dynamic' });
    }
    return routes;
  }

  clear() {
    this.staticRoutes.clear();
    this.dynamicRoutes.length = 0;
    this.globalMiddlewares.length = 0;
    this.prefixMiddlewares.length = 0;
    this.routeCache.clear();
    return this;
  }
}

export default AetherRouter;
