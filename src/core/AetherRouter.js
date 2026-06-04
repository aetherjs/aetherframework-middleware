/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/core/AetherRouter
 */

import { EventEmitter } from "events";

/**
 * AetherRouter - V8-Optimized High-Performance Router.
 * Philosophy: Flat arrays, simple loops, zero deep closures, native V8 optimizations.
 */
class AetherRouter extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // [V8-OPT] Flat arrays for routes. V8 optimizes continuous memory arrays better than Maps.
    this.staticRoutes = []; 
    this.dynamicRoutes = []; 
    
    this.globalMiddlewares = [];
    this.prefixMiddlewares = [];
    
    this.prefix = options.prefix || ""; 
    this.version = options.version || ""; 
    
    // [V8-OPT] Pure Cache with batch eviction
    this.routeCache = new Map();
    this.cacheMaxSize = options.cacheMaxSize || 2000; 
    
    this.methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD", "ANY"];
    this.methods.forEach(method => {
      this[method.toLowerCase()] = this._createRouteHandler(method);
    });
    this.all = this._createRouteHandler("ANY");
  }

  _createRouteHandler(method) {
    return (path, ...handlers) => {
      if (handlers.length === 0) throw new Error(`Route ${method} ${path} must have at least one handler`);
      
      const fullPath = this._buildPath(path);
      const isStatic = fullPath.indexOf(':') === -1 && fullPath.indexOf('*') === -1;
      
      const route = {
        method: method === "ANY" ? null : method,
        path: fullPath,
        isStatic,
        handlers: this._wrapHandlers(handlers),
        regex: isStatic ? null : this._pathToRegex(fullPath),
        paramNames: isStatic ? [] : this._extractParamNames(fullPath)
      };
      
      // [V8-OPT] Push to flat arrays instead of Maps
      if (isStatic) {
        this.staticRoutes.push(route);
      } else {
        this.dynamicRoutes.push(route);
      }
      
      this.emit("route:added", { method, path: fullPath, handlers: handlers.length });
      return this;
    };
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
      .replace(/\\:(\w+)/g, "(?<$1>[^/]+)") 
      .replace(/\\\*(\w+)?/g, (_, name) => name ? `(?<${name}>.*)` : "(.*)") 
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
    return handlers.map((handler, index) => {
      if (typeof handler !== "function") throw new TypeError(`Route handler must be a function, got ${typeof handler} at position ${index}`);
      return handler;
    });
  }

  group(prefix, callback) {
    const router = new AetherRouter({ prefix: `${this.prefix}/${prefix}`.replace(/\/+/g, "/"), version: this.version });
    router.globalMiddlewares = [...this.globalMiddlewares];
    router.prefixMiddlewares = [...this.prefixMiddlewares];
    callback(router);
    this.staticRoutes.push(...router.staticRoutes);
    this.dynamicRoutes.push(...router.dynamicRoutes);
    return this;
  }

  version(version, callback) {
    const router = new AetherRouter({ prefix: this.prefix, version: version });
    router.globalMiddlewares = [...this.globalMiddlewares];
    router.prefixMiddlewares = [...this.prefixMiddlewares];
    callback(router);
    this.staticRoutes.push(...router.staticRoutes);
    this.dynamicRoutes.push(...router.dynamicRoutes);
    return this;
  }

  use(...args) {
    if (args.length === 0) return this;

    if (typeof args[0] === 'function' && typeof args[1] === 'string') {
      const path = args[1];
      const middlewares = [args[0], ...args.slice(2)];
      args = [path, ...middlewares];
    }

    if (typeof args[0] === 'string') {
      const path = args[0]; 
      const middlewares = args.slice(1);
      
      middlewares.forEach((middleware, index) => {
        if (typeof middleware !== "function") {
          if (middleware && typeof middleware.middleware === 'function') middlewares[index] = middleware.middleware();
          else throw new TypeError(`Middleware for path "${path}" must be a function, got ${typeof middleware}`);
        }
      });
      
      const normalizedPath = path === '/' ? '/' : path.replace(/\/+$/, '');
      const escapedPath = normalizedPath.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const prefixRegex = normalizedPath === '/' ? null : new RegExp(`^${escapedPath}(?=/|$|\\?)`, 'i');
      
      const wrappedMiddlewares = middlewares.map(mw => {
        return async (ctx, next) => {
          if (!prefixRegex) return mw(ctx, next);
          const originalUrl = ctx.url;
          const originalPath = ctx.path; 
          if (prefixRegex.test(originalUrl)) {
            let newUrl = originalUrl.replace(prefixRegex, '');
            if (!newUrl.startsWith('/')) newUrl = '/' + newUrl;
            ctx.url = newUrl;
            try { if ('path' in ctx) ctx.path = newUrl.split('?')[0]; } catch(e) {}
            try { await mw(ctx, next); } finally {
              ctx.url = originalUrl;
              try { if ('path' in ctx) ctx.path = originalPath; } catch(e) {}
            }
          } else { await next(); }
        };
      });

      if (normalizedPath === '/') {
        this.globalMiddlewares.push(...wrappedMiddlewares);
      } else {
        this.prefixMiddlewares.push({ path: normalizedPath, handlers: wrappedMiddlewares });
      }
    } else {
      args.forEach((middleware, index) => {
        if (typeof middleware !== "function") throw new TypeError(`Global middleware must be a function, got ${typeof middleware}`);
      });
      this.globalMiddlewares.push(...args);
    }
    return this;
  }

  /**
   * [V8-OPT] Flat array iteration, simple string matching, native split.
   */
  match(method, url) {
    // [V8-OPT] Native indexOf is faster than custom state machines for simple splits
    const qIndex = url.indexOf("?");
    const pathname = qIndex === -1 ? url : url.substring(0, qIndex);
    const search = qIndex === -1 ? null : url.substring(qIndex + 1);
    
    const cacheKey = `${method}:${pathname}`;

    // 1. Pure Cache Hit
    const cached = this.routeCache.get(cacheKey);
    if (cached !== undefined) {
      return {
        route: cached.route,
        params: cached.params,
        query: this._parseQuery(search),
        handlers: cached.handlers // Return flat array, let executor handle it
      };
    }

    // 2. Collect middlewares (Pre-allocate array size for V8 optimization)
    const applicableMiddlewares = [];
    const gLen = this.globalMiddlewares.length;
    for (let i = 0; i < gLen; i++) applicableMiddlewares.push(this.globalMiddlewares[i]);
    
    const pLen = this.prefixMiddlewares.length;
    for (let i = 0; i < pLen; i++) {
      const mw = this.prefixMiddlewares[i];
      const mwPath = mw.path.endsWith('/') ? mw.path : mw.path + '/';
      if (pathname === mw.path || pathname.startsWith(mwPath)) {
        const hLen = mw.handlers.length;
        for (let j = 0; j < hLen; j++) applicableMiddlewares.push(mw.handlers[j]);
      }
    }

    let matchedRoute = null;
    let params = {};

    // 3. [V8-OPT] Static Route Fast-Path (Simple === comparison, NO REGEX, NO MAP)
    const sLen = this.staticRoutes.length;
    for (let i = 0; i < sLen; i++) {
      const route = this.staticRoutes[i];
      if ((route.method === method || route.method === null) && route.path === pathname) {
        matchedRoute = route;
        break;
      }
    }

    // 4. Fallback to Dynamic Routes (Regex)
    if (!matchedRoute) {
      const dLen = this.dynamicRoutes.length;
      for (let i = 0; i < dLen; i++) {
        const route = this.dynamicRoutes[i];
        if (route.method !== null && route.method !== method) continue;
        
        const match = pathname.match(route.regex);
        if (match) {
          matchedRoute = route;
          if (match.groups) Object.assign(params, match.groups);
          const pnLen = route.paramNames.length;
          for (let j = 0; j < pnLen; j++) {
            const name = route.paramNames[j];
            if (!params[name] && match[j + 1]) params[name] = match[j + 1];
          }
          break;
        }
      }
    }

    // 5. Build and Cache handler chain
    if (matchedRoute) {
      // [V8-OPT] Concat is highly optimized in V8 for flat arrays
      const finalHandlers = applicableMiddlewares.concat(matchedRoute.handlers);
      
      if (this.routeCache.size >= this.cacheMaxSize) this.routeCache.clear();
      this.routeCache.set(cacheKey, { route: matchedRoute, params, handlers: finalHandlers });

      return { route: matchedRoute, params, query: this._parseQuery(search), handlers: finalHandlers };
    }
    
    if (applicableMiddlewares.length > 0) {
      if (this.routeCache.size >= this.cacheMaxSize) this.routeCache.clear();
      this.routeCache.set(cacheKey, { route: null, params: {}, handlers: applicableMiddlewares });
      return { route: null, params: {}, query: this._parseQuery(search), handlers: applicableMiddlewares };
    }
    
    return null;
  }

  /**
   * [V8-OPT] Reverted to native split. V8's C++ implementation of split 
   * is vastly faster than any JS-level charCodeAt state machine.
   */
  _parseQuery(search) {
    const query = {};
    if (!search) return query;
    const pairs = search.split("&");
    const len = pairs.length;
    for (let i = 0; i < len; i++) {
      const pair = pairs[i];
      const eqIndex = pair.indexOf("=");
      if (eqIndex !== -1) {
        const key = decodeURIComponent(pair.substring(0, eqIndex));
        const value = decodeURIComponent(pair.substring(eqIndex + 1));
        if (key.endsWith("[]")) {
          const arrayKey = key.slice(0, -2);
          if (!query[arrayKey]) query[arrayKey] = [];
          query[arrayKey].push(value);
        } else {
          query[key] = value;
        }
      } else if (pair) {
        query[decodeURIComponent(pair)] = "";
      }
    }
    return query;
  }

  middleware() {
    return async (context, next) => {
      const match = this.match(context.method, context.url);
      
      if (match) {
        context.params = match.params;
        context.setState("query", match.query); 
        context.route = match.route;
        
        if (match.handlers && match.handlers.length > 0) {
          await this._executeHandlers(context, match.handlers);
        } else if (typeof next === "function") {
          await next();
        }
        
        if (!context.isTerminated() && !match.route && typeof next === "function") {
            await next();
        }
      } else if (typeof next === "function") {
        await next();
      } else {
        context.setStatus(404).json({ success: false, error: "Not Found", message: `Route ${context.method} ${context.url} not found` });
      }
    };
  }

  /**
   * [V8-OPT] Simple while-loop executor. 
   * V8 JIT compiles simple loops much better than recursive compose closures.
   */
  async _executeHandlers(context, handlers) {
    let index = 0;
    const len = handlers.length;
    
    const executeNext = async () => {
      if (index >= len || context.isTerminated()) return;
      const handler = handlers[index++];
      
      try {
        await handler(context, executeNext);
      } catch (error) {
        console.error(`[AetherRouter Error]`, error);
        if (!context.isTerminated()) {
            context.setStatus(500).json({ success: false, error: "Internal Server Error", message: error.message });
        }
      }
    };
    
    await executeNext();
  }

  getRoutes() {
    const routes = [];
    this.staticRoutes.forEach(r => routes.push({ method: r.method || "ALL", path: r.path, type: 'static' }));
    this.dynamicRoutes.forEach(r => routes.push({ method: r.method || "ALL", path: r.path, type: 'dynamic' }));
    return routes;
  }

  clear() {
    this.staticRoutes = [];
    this.dynamicRoutes = [];
    this.globalMiddlewares = [];
    this.prefixMiddlewares = [];
    this.routeCache.clear();
    return this;
  }
}

export default AetherRouter;
