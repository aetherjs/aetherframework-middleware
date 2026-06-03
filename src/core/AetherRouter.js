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
    this.routes = new Map(); // Store all routes: method+path -> handler
    this.groups = new Map(); // Store route groups
    this.middlewares = []; // Global middlewares
    this.prefix = options.prefix || ""; // Route prefix
    this.version = options.version || ""; // API version
    
    // Supported HTTP methods
    this.methods = [
      "GET", "POST", "PUT", "DELETE", 
      "PATCH", "OPTIONS", "HEAD", "ANY"
    ];
    
    // Initialize all HTTP method handlers
    this.methods.forEach(method => {
      this[method.toLowerCase()] = this._createRouteHandler(method);
    });
    
    // Special method: match any HTTP method
    this.all = this._createRouteHandler("ANY");
  }

  /**
   * Create route handler for specific HTTP method
   * @private
   */
  _createRouteHandler(method) {
    return (path, ...handlers) => {
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

  /**
   * Build full path with prefix and version
   * @private
   */
  _buildPath(path) {
    let fullPath = "";
    
    // Add version prefix
    if (this.version) {
      fullPath += `/v${this.version.replace(/[^0-9.]/g, "")}`;
    }
    
    // Add group prefix
    if (this.prefix) {
      fullPath += `/${this.prefix.replace(/^\/|\/$/g, "")}`;
    }
    
    // Add route path
    fullPath += `/${path.replace(/^\/|\/$/g, "")}`;
    
    // Normalize path
    return fullPath.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  }

  /**
   * Convert path pattern to regex
   * @private
   */
  _pathToRegex(path) {
    const pattern = path
      .replace(/:(\w+)/g, "(?<$1>[^/]+)") // Named parameters: :id
      .replace(/\*(\w+)?/g, (_, name) => name ? `(?<${name}>.*)` : "(.*)") // Wildcards
      .replace(/$([^)]+)$/g, "(?:$1)") // Optional groups
      .replace(/\?/g, "\\?"); // Escape question marks
    
    return new RegExp(`^${pattern}$`);
  }

  /**
   * Extract parameter names from path
   * @private
   */
  _extractParamNames(path) {
    const paramNames = [];
    const paramPattern = /:(\w+)/g;
    const wildcardPattern = /\*(\w+)?/g;
    
    let match;
    while ((match = paramPattern.exec(path)) !== null) {
      paramNames.push(match);
    }
    
    while ((match = wildcardPattern.exec(path)) !== null) {
      if (match) paramNames.push(match);
    }
    
    return paramNames;
  }

  /**
   * Wrap handlers with validation
   * @private
   */
  _wrapHandlers(handlers) {
    return handlers.map(handler => {
      if (typeof handler !== "function") {
        throw new TypeError("Route handler must be a function");
      }
      return handler;
    });
  }

  /**
   * Route grouping
   * @param {string} prefix - Group prefix
   * @param {Function} callback - Group definition function
   */
  group(prefix, callback) {
    const router = new AetherRouter({
      prefix: `${this.prefix}/${prefix}`.replace(/\/+/g, "/"),
      version: this.version
    });
    
    // Inherit global middlewares
    router.middlewares = [...this.middlewares];
    
    // Execute group definition
    callback(router);
    
    // Merge group routes into main router
    router.routes.forEach((route, key) => {
      this.routes.set(key, route);
    });
    
    return this;
  }

  /**
   * API versioning
   * @param {string} version - Version number (e.g., "1", "2.0")
   * @param {Function} callback - Version definition function
   */
 version(version, callback) {
  const router = new AetherRouter({
    prefix: this.prefix,
    version: version
  });
  
  // Inherit global middlewares
  router.middlewares = [...this.middlewares];
  
  // Execute version definition
  callback(router);
  
  // Merge version routes into main router
  router.routes.forEach((route, key) => {
    this.routes.set(key, route);
  });
  
  return this;
}

  /**
   * Add middleware to router
   * @param {...Function} middlewares - Middleware functions
   */
  use(...middlewares) {
    this.middlewares.push(...middlewares);
    return this;
  }

  /**
   * Match route for incoming request
   * @param {string} method - HTTP method
   * @param {string} url - Request URL
   * @returns {Object|null} - Matched route info or null
   */
  match(method, url) {
    // Parse URL and query parameters
    const [pathname, search] = url.split("?");
    const query = this._parseQuery(search);
    
    // Find matching route
    for (const [routeKey, route] of this.routes) {
      const [routeMethod, routePath] = routeKey.split(":");
      
      // Check method match
      if (routeMethod !== "ANY" && routeMethod !== method) {
        continue;
      }
      
      // Check path match
      const match = pathname.match(route.regex);
      if (match) {
        const params = {};
        
        // Extract named parameters
        if (match.groups) {
          Object.assign(params, match.groups);
        }
        
        // Extract positional parameters
        route.paramNames.forEach((name, index) => {
          if (!params[name] && match[index + 1]) {
            params[name] = match[index + 1];
          }
        });
        
        return {
          route,
          params,
          query,
          handlers: [...this.middlewares, ...route.handlers]
        };
      }
    }
    
    return null;
  }

  /**
   * Parse query string parameters
   * @private
   */
  _parseQuery(search) {
    const query = {};
    if (!search) return query;
    
    const pairs = search.split("&");
    for (const pair of pairs) {
      const [key, value] = pair.split("=");
      if (key) {
        const decodedKey = decodeURIComponent(key);
        const decodedValue = value ? decodeURIComponent(value) : "";
        
        // Support array parameters: key[]=value1&key[]=value2
        if (decodedKey.endsWith("[]")) {
          const arrayKey = decodedKey.slice(0, -2);
          if (!query[arrayKey]) {
            query[arrayKey] = [];
          }
          query[arrayKey].push(decodedValue);
        } else {
          query[decodedKey] = decodedValue;
        }
      }
    }
    
    return query;
  }

  /**
   * Generate router middleware for AetherPipeline
   */
  middleware() {
    return async (context, next) => {
      const match = this.match(context.method, context.url);
      
      if (match) {
        // Set route parameters and query parameters
        context.params = match.params;
        context.setState("query", match.query); 
        context.route = match.route;
        
        // Execute route handler chain
        await this._executeHandlers(context, match.handlers);
      } else if (typeof next === "function") {
        // No matching route, continue to next middleware
        await next();
      } else {
        // Return 404
        context.setStatus(404).json({
          error: "Not Found",
          message: `Route ${context.method} ${context.url} not found`,
          timestamp: new Date().toISOString()
        });
      }
    };
  }

  /**
   * Execute handler chain
   * @private
   */
  async _executeHandlers(context, handlers) {
    let index = 0;
    
    const executeNext = async () => {
      if (index >= handlers.length || context.isTerminated()) {
        return;
      }
      
      const handler = handlers[index++];
      await handler(context, executeNext);
    };
    
    await executeNext();
  }

  /**
   * Get all registered routes (for debugging)
   */
  getRoutes() {
    const routes = [];
    this.routes.forEach((route, key) => {
      const [method, path] = key.split(":");
      routes.push({
        method: method === "ANY" ? "ALL" : method,
        path,
        handlers: route.handlers.length
      });
    });
    return routes;
  }

  /**
   * Clear all routes and middlewares
   */
  clear() {
    this.routes.clear();
    this.groups.clear();
    this.middlewares = [];
    return this;
  }
}

export default AetherRouter;
