/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/core/AetherRouter
 */

import { EventEmitter } from "events";

/**
 * AetherRouter - High-performance routing system for AetherJS
 * Supports versioning, grouping, parameter parsing, and middleware chaining
 */
class AetherRouter extends EventEmitter {
  constructor(options = {}) {
    super();
    this.routes = new Map(); 
    this.groups = new Map(); 
    this.middlewares = []; 
    this.prefix = options.prefix || ""; 
    this.version = options.version || ""; 
    
    this.methods = [
      "GET", "POST", "PUT", "DELETE", 
      "PATCH", "OPTIONS", "HEAD", "ANY"
    ];
    
    this.methods.forEach(method => {
      this[method.toLowerCase()] = this._createRouteHandler(method);
    });
    
    this.all = this._createRouteHandler("ANY");
  }

  _createRouteHandler(method) {
    return (path, ...handlers) => {
      if (handlers.length === 0) {
        throw new Error(`Route ${method} ${path} must have at least one handler`);
      }
      
      const fullPath = this._buildPath(path);
      const route = {
        method: method === "ANY" ? null : method,
        path: fullPath,
        handlers: this._wrapHandlers(handlers),
        regex: this._pathToRegex(fullPath),
        paramNames: this._extractParamNames(fullPath)
      };
      
      const routeKey = `${method}:${fullPath}`;
      this.routes.set(routeKey, route);
      
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
      if (typeof handler !== "function") {
        throw new TypeError(`Route handler must be a function, got ${typeof handler} at position ${index}`);
      }
      return handler;
    });
  }

  group(prefix, callback) {
    const router = new AetherRouter({
      prefix: `${this.prefix}/${prefix}`.replace(/\/+/g, "/"),
      version: this.version
    });
    router.middlewares = [...this.middlewares];
    callback(router);
    router.routes.forEach((route, key) => this.routes.set(key, route));
    return this;
  }

  version(version, callback) {
    const router = new AetherRouter({ prefix: this.prefix, version: version });
    router.middlewares = [...this.middlewares];
    callback(router);
    router.routes.forEach((route, key) => this.routes.set(key, route));
    return this;
  }


  use(...args) {
    if (args.length === 0) return this;

    if (typeof args[0] === 'string') {
      const path = args[0]; 
      const middlewares = args.slice(1);
      
      middlewares.forEach((middleware, index) => {
        if (typeof middleware !== "function") {
          throw new TypeError(`Middleware for path "${path}" must be a function, got ${typeof middleware}`);
        }
      });
      
    
      const normalizedPath = path === '/' ? '/' : path.replace(/\/+$/, '');
      
  
      const wrappedMiddlewares = middlewares.map(mw => {
        return async (ctx, next) => {
          if (normalizedPath === '/') {
            return mw(ctx, next);
          }

          const originalUrl = ctx.url;
          const originalPath = ctx.path; 

       
          const escapedPath = normalizedPath.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const prefixRegex = new RegExp(`^${escapedPath}(?=/|$|\\?)`, 'i');

          if (prefixRegex.test(originalUrl)) {
  
            let newUrl = originalUrl.replace(prefixRegex, '');
            if (!newUrl.startsWith('/')) newUrl = '/' + newUrl;
            
 
            ctx.url = newUrl;
            try { if ('path' in ctx) ctx.path = newUrl.split('?')[0]; } catch(e) {}
            
            try {
              await mw(ctx, next);
            } finally {
              ctx.url = originalUrl;
              try { if ('path' in ctx) ctx.path = originalPath; } catch(e) {}
            }
          } else {
            await mw(ctx, next);
          }
        };
      });

      this.middlewares.push({ path: normalizedPath, handlers: wrappedMiddlewares });
    } else {
      args.forEach((middleware, index) => {
        if (typeof middleware !== "function") {
          throw new TypeError(`Global middleware must be a function, got ${typeof middleware}`);
        }
      });
      
      this.middlewares.push({ path: '/', handlers: args });
    }
    
    return this;
  }

  /**
   * Match route for incoming request
   */
  match(method, url) {
    const [pathname, search] = url.split("?");
    const query = this._parseQuery(search);
    
    const applicableMiddlewares = [];
    
    this.middlewares.forEach(mw => {
      if (typeof mw === 'function') {
        applicableMiddlewares.push(mw);
      } else if (mw && typeof mw === 'object' && mw.path) {
        const mwPath = mw.path === '/' ? '/' : (mw.path.endsWith('/') ? mw.path : mw.path + '/');
        if (pathname === mw.path || pathname.startsWith(mwPath)) {
          applicableMiddlewares.push(...mw.handlers);
        }
      }
    });
    
    for (const [routeKey, route] of this.routes) {
      const [routeMethod, routePath] = routeKey.split(":");
      
      if (routeMethod !== "ANY" && routeMethod !== method) continue;
      
      const match = pathname.match(route.regex);
      if (match) {
        const params = {};
        if (match.groups) Object.assign(params, match.groups);
        
        route.paramNames.forEach((name, index) => {
          if (!params[name] && match[index + 1]) params[name] = match[index + 1];
        });
        
        const allHandlers = [...applicableMiddlewares, ...route.handlers];
        return {
          route,
          params,
          query,
          handlers: allHandlers.filter(h => typeof h === "function")
        };
      }
    }
    
    if (applicableMiddlewares.length > 0) {
      return {
        route: null,
        params: {},
        query,
        handlers: applicableMiddlewares.filter(h => typeof h === "function")
      };
    }
    
    return null;
  }

  _parseQuery(search) {
    const query = {};
    if (!search) return query;
    const pairs = search.split("&");
    for (const pair of pairs) {
      const [key, value] = pair.split("=");
      if (key) {
        const decodedKey = decodeURIComponent(key);
        const decodedValue = value ? decodeURIComponent(value) : "";
        if (decodedKey.endsWith("[]")) {
          const arrayKey = decodedKey.slice(0, -2);
          if (!query[arrayKey]) query[arrayKey] = [];
          query[arrayKey].push(decodedValue);
        } else {
          query[decodedKey] = decodedValue;
        }
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
        
        if (!match.handlers || !Array.isArray(match.handlers) || match.handlers.length === 0) {
           if (typeof next === "function") await next();
           return;
        }
        
        await this._executeHandlers(context, match.handlers);
        
        if (!context.isTerminated() && !match.route && typeof next === "function") {
            await next();
        }
      } else if (typeof next === "function") {
        await next();
      } else {
        context.setStatus(404).json({
          success: false,
          error: "Not Found",
          message: `Route ${context.method} ${context.url} not found`,
          timestamp: new Date().toISOString()
        });
      }
    };
  }

  async _executeHandlers(context, handlers) {
    let index = 0;
    const executeNext = async () => {
      if (index >= handlers.length || context.isTerminated()) return;
      const handler = handlers[index++];
      
      if (typeof handler !== "function") {
        if (index < handlers.length) await executeNext();
        return;
      }
      
      try {
        await handler(context, executeNext);
      } catch (error) {
        console.error(`[AetherRouter Error] Handler execution failed:`, error);
        if (!context.isTerminated()) {
            context.setStatus(500).json({
              success: false,
              error: "Internal Server Error",
              message: error.message,
              timestamp: new Date().toISOString()
            });
        }
      }
    };
    await executeNext();
  }

  getRoutes() {
    const routes = [];
    this.routes.forEach((route, key) => {
      const [method, path] = key.split(":");
      routes.push({ method: method === "ANY" ? "ALL" : method, path, handlers: route.handlers.length });
    });
    return routes;
  }

  clear() {
    this.routes.clear();
    this.groups.clear();
    this.middlewares = [];
    return this;
  }
}

export default AetherRouter;
