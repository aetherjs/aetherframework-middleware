/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/core/AetherRouter
 * 
 * Ultra-Optimized Router for Maximum Performance
 * Focus: Pure routing speed with zero overhead
 */

// [PERF] Pre-allocated frozen objects to prevent heap allocation in hot paths
const EMPTY_PARAMS = Object.freeze({});
const EMPTY_QUERY = Object.freeze({});

/**
 * [PERF] Zero-Allocation Query Parser
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
 * [PERF] Optimized Handler Executor with Manual Loop Unrolling
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
    
    return async (context) => {
      let index = 0;
      const next = async () => {
        if (index >= handlers.length || context.isTerminated()) return;
        const handler = handlers[index++];
        try {
          await handler(context, next);
        } catch (error) {
          if (!context.isTerminated()) {
            context.setStatus(500).json({ error: "Internal Server Error" });
          }
        }
      };
      await next();
    };
  }

  async _exec0(ctx) {}
  
  // [FIX] 修复了 this 指向问题，this 现在是 handlers 数组
  async _exec1(ctx) {
    if (ctx.isTerminated()) return;
    try { await this[0](ctx, async () => {}); } 
    catch (e) { if (!ctx.isTerminated()) ctx.setStatus(500).json({ error: "Internal Server Error" }); }
  }
  
  async _exec2(ctx) {
    if (ctx.isTerminated()) return;
    try { 
      await this[0](ctx, async () => { 
        if (!ctx.isTerminated()) await this[1](ctx, async () => {}); 
      }); 
    } catch (e) { if (!ctx.isTerminated()) ctx.setStatus(500).json({ error: "Internal Server Error" }); }
  }
  
  async _exec3(ctx) {
    if (ctx.isTerminated()) return;
    try { 
      await this[0](ctx, async () => { 
        if (!ctx.isTerminated()) await this[1](ctx, async () => { 
          if (!ctx.isTerminated()) await this[2](ctx, async () => {}); 
        }); 
      }); 
    } catch (e) { if (!ctx.isTerminated()) ctx.setStatus(500).json({ error: "Internal Server Error" }); }
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
    } catch (e) { if (!ctx.isTerminated()) ctx.setStatus(500).json({ error: "Internal Server Error" }); }
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
    } catch (e) { if (!ctx.isTerminated()) ctx.setStatus(500).json({ error: "Internal Server Error" }); }
  }
}

class AetherRouter {
  constructor(options = {}) {
    this.staticRoutes = new Map(); 
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
    
    const route = {
      method: method === "ANY" ? null : method,
      path: fullPath,
      isStatic: isStatic,
      handlers: this._wrapHandlers(handlers),
      regex: isStatic ? null : this._pathToRegex(fullPath),
      paramNames: isStatic ? [] : this._extractParamNames(fullPath)
    };
    
    if (isStatic) {
      this.staticRoutes.set(`${route.method || 'ANY'}:${fullPath}`, route);
    } else {
      this.dynamicRoutes.push(route);
    }
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
      .replace(/\\:(\w+)/g, "([^/]+)") 
      .replace(/\\*(\w+)?/g, "(.*)") 
      .replace(/\\\?/g, "\\?");
    return new RegExp(`^${pattern}$`);
  }

  // [FIX] 修复了 push(match) 导致推入整个 RegExp 数组的问题
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
    for (let i = 0; i < router.dynamicRoutes.length; i++) this.dynamicRoutes.push(router.dynamicRoutes[i]);
    return this;
  }

  version(version, callback) {
    const router = new AetherRouter({ prefix: this.prefix, version: version });
    router.globalMiddlewares = this.globalMiddlewares.slice();
    router.prefixMiddlewares = this.prefixMiddlewares.slice();
    callback(router);
    
    router.staticRoutes.forEach((route, key) => this.staticRoutes.set(key, route));
    for (let i = 0; i < router.dynamicRoutes.length; i++) this.dynamicRoutes.push(router.dynamicRoutes[i]);
    return this;
  }

  // [FIX] 重写了 use 方法，修复了 typeof args 永远为 'object' 的致命判断错误
  use(...args) {
    if (args.length === 0) return this;

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
            if (newUrl.charCodeAt(0) !== 47) newUrl = '/' + newUrl;
            ctx.url = newUrl;
            try {
              // [FIX] 修复了 split('?') 返回数组导致 ctx.path 类型错误的问题
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

  match(method, url) {
    const qIndex = url.indexOf("?");
    const pathname = qIndex === -1 ? url : url.substring(0, qIndex);
    const search = qIndex === -1 ? null : url.substring(qIndex + 1);
    
    const cacheKey = method + ":" + pathname;
    const cached = this.routeCache.get(cacheKey);
    
    if (cached !== undefined) {
      const route = cached.route;
      const params = route && !route.isStatic ? this._extractParams(route, pathname) : EMPTY_PARAMS;
      return {
        route: route,
        params: params,
        query: search ? this.jitQueryParser.parse(search) : EMPTY_QUERY,
        handlers: cached.handlers
      };
    }

    const applicableMiddlewares = [];
    for (let i = 0; i < this.globalMiddlewares.length; i++) applicableMiddlewares.push(this.globalMiddlewares[i]);
    
    for (let i = 0; i < this.prefixMiddlewares.length; i++) {
      const mw = this.prefixMiddlewares[i];
      const mwPath = mw.path;
      const mwPathSlash = mwPath.endsWith('/') ? mwPath : mwPath + '/';
      if (pathname === mwPath || pathname.startsWith(mwPathSlash)) {
        for (let j = 0; j < mw.handlers.length; j++) applicableMiddlewares.push(mw.handlers[j]);
      }
    }

    let matchedRoute = null;
    matchedRoute = this.staticRoutes.get(method + ":" + pathname) || this.staticRoutes.get("ANY:" + pathname);

    // [FIX] 修复了高并发下 _lastMatch 挂载在共享 route 对象上导致的“串参”竞态条件问题
    let dynamicMatch = null; 
    if (!matchedRoute) {
      for (let i = 0; i < this.dynamicRoutes.length; i++) {
        const route = this.dynamicRoutes[i];
        if (route.method !== null && route.method !== method) continue;
        
        const match = route.regex.exec(pathname);
        if (match) {
          matchedRoute = route;
          dynamicMatch = match; // 使用局部变量保存匹配结果
          break;
        }
      }
    }

    if (matchedRoute) {
      const finalHandlers = applicableMiddlewares.concat(matchedRoute.handlers);
      if (this.routeCache.size >= this.cacheMaxSize) this.routeCache.clear();
      this.routeCache.set(cacheKey, { route: matchedRoute, handlers: finalHandlers });

      const params = matchedRoute.isStatic ? EMPTY_PARAMS : this._extractParams(matchedRoute, pathname, dynamicMatch);
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

  _extractParams(route, pathname, existingMatch) {
    const match = existingMatch || route.regex.exec(pathname);
    if (!match) return EMPTY_PARAMS;
    
    const params = {};
    const names = route.paramNames;
    for (let i = 0; i < names.length; i++) {
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
        
        if (typeof context.setState === "function") {
          context.setState("query", match.query);
        } else {
          try { context.query = match.query; } catch (e) { /* Ignore */ }
        }
        
        if (match.handlers && match.handlers.length > 0) {
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
        context.setStatus(404).json({ error: "Not Found" });
      }
    };
  }

  getRoutes() {
    const routes = [];
    this.staticRoutes.forEach(r => routes.push({ method: r.method || "ALL", path: r.path, type: 'static' }));
    for (let i = 0; i < this.dynamicRoutes.length; i++) {
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
