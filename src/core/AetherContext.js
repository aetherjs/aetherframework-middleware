/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/core/AetherContext
 * 
 * Ultra-Optimized Request Context for Maximum Performance
 * Removed all statistics, metrics, and monitoring overhead
 * Focus: Zero-allocation context management with minimal overhead
 */

/**
 * AetherContext - High-performance request context optimized for V8
 * Removed all statistics tracking and metrics collection
 * Focus: Pure request/response handling with maximum speed
 */
class AetherContext {
  constructor(request, response) {
    // ==========================================
    // [V8-OPT] MONOMORPHIC PROPERTY LAYOUT
    // ==========================================
    // All properties initialized in same order for V8 Hidden Class optimization
    this._request = null;
    this._response = null;
    
    // Request metadata
    this.method = "";
    this.url = "";
    this.headers = null;
    this.path = "";
    this._queryString = "";
    
    // [PERF] Flat header storage for O(1) access
    this._headersObj = {};
    this._headersCount = 0;
    this._headersKeys = new Array(32); // Pre-allocated array to avoid resizing
    
    // Cached computations
    this._queryCache = null;
    this._ipCache = null;
    
    // Response state
    this.statusCode = 200;
    this._body = null;
    this._terminated = false;
    
    // [PERF] State storage (removed metrics tracking)
    this._stateObj = {};
    
    // Initialize if request/response provided
    if (request && response) {
      this._reset(request, response);
    }
  }
  
  /**
   * Reset context for reuse (object pooling)
   * @param {Object} request - HTTP request object
   * @param {Object} response - HTTP response object
   */
  _reset(request, response) {
    this._request = request;
    this._response = response;
    
    // [PERF] Direct property assignment (faster than Object.assign)
    this.method = request.method;
    const rawUrl = request.url || "/";
    this.url = rawUrl;
    this.headers = request.headers;
    
    // [PERF] Fast URL parsing without regex
    const qIdx = rawUrl.indexOf("?");
    if (qIdx !== -1) {
      this.path = rawUrl.substring(0, qIdx);
      this._queryString = rawUrl.substring(qIdx + 1);
    } else {
      this.path = rawUrl;
      this._queryString = "";
    }
    
    // Reset cached values
    this._queryCache = null;
    this._ipCache = null;
    
    // Reset response state
    this.statusCode = 200;
    this._body = null;
    this._terminated = false;
    
    // [PERF] Clear headers without re-allocating objects
    if (this._headersCount > 0) {
      for (let i = 0; i < this._headersCount; i++) {
        this._headersObj[this._headersKeys[i]] = undefined;
      }
      this._headersCount = 0;
    }
    
    // [PERF] Clear state without re-allocating object
    for (const key in this._stateObj) {
      delete this._stateObj[key];
    }
    
    // [PERF] REMOVED: _startTime and metrics tracking
    // this._startTime = process.hrtime.bigint(); // Statistics removed
  }
  
  // ==========================================
  // [PERF] PROPERTY GETTERS/SETTERS
  // ==========================================
  
  /**
   * Get response body
   */
  get body() {
    return this._body;
  }
  
  /**
   * Set response body and finalize
   * @param {any} value - Response body value
   */
  set body(value) {
    if (this._terminated) return;
    this._body = value;
    this._finalize();
  }
  
  /**
   * Get client IP address with caching
   */
  get ip() {
    if (this._ipCache) return this._ipCache;
    
    const sock = this._request?.socket;
    // [PERF] Simple IP extraction without proxy header checks
    return (this._ipCache = sock ? sock.remoteAddress : "127.0.0.1");
  }
  
  /**
   * Get parsed query parameters with caching
   */
  get query() {
    if (this._queryCache) return this._queryCache;
    if (!this._queryString) return (this._queryCache = {});
    
    const obj = {};
    const pairs = this._queryString.split("&");
    
    // [PERF] Manual parsing without try-catch for common case
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const eqIdx = pair.indexOf("=");
      
      if (eqIdx !== -1) {
        // [PERF] Fast path: decode only when needed
        const key = pair.substring(0, eqIdx);
        const value = pair.substring(eqIdx + 1);
        
        // [PERF] Skip decodeURIComponent for simple ASCII
        if (key.indexOf("%") === -1 && value.indexOf("%") === -1) {
          obj[key] = value;
        } else {
          try {
            obj[decodeURIComponent(key)] = decodeURIComponent(value);
          } catch {
            // Fallback for malformed URIs
            obj[key] = value;
          }
        }
      } else {
        // Key without value
        const key = pair;
        if (key.indexOf("%") === -1) {
          obj[key] = "";
        } else {
          try {
            obj[decodeURIComponent(key)] = "";
          } catch {
            obj[key] = "";
          }
        }
      }
    }
    
    return (this._queryCache = obj);
  }
  
  // ==========================================
  // [PERF] HEADER MANAGEMENT
  // ==========================================
  
  /**
   * Set response header
   * @param {string} key - Header name
   * @param {string} value - Header value
   * @returns {AetherContext} - Chainable
   */
  setHeader(key, value) {
    if (this._terminated) return this;
    
    // [PERF] Lowercase for consistency with Node.js
    const lowerKey = key.toLowerCase();
    
    // [PERF] Track header keys for fast iteration
    if (this._headersObj[lowerKey] === undefined) {
      if (this._headersCount < this._headersKeys.length) {
        this._headersKeys[this._headersCount] = lowerKey;
      } else {
        this._headersKeys.push(lowerKey);
      }
      this._headersCount++;
    }
    
    this._headersObj[lowerKey] = value;
    return this;
  }
  
  /**
   * Get header value (request headers first, then response headers)
   * @param {string} key - Header name
   * @returns {string|null} - Header value or null
   */
  getHeader(key) {
    const lowerKey = key.toLowerCase();
    return (
      this.headers?.[lowerKey] ||
      this._headersObj[lowerKey] ||
      null
    );
  }
  
  // ==========================================
  // [PERF] RESPONSE METHODS
  // ==========================================
  
  /**
   * Set HTTP status code
   * @param {number} code - Status code
   * @returns {AetherContext} - Chainable
   */
  setStatus(code) {
    if (this._terminated) return this;
    this.statusCode = code;
    return this;
  }
  
  /**
   * Send JSON response
   * @param {any} data - Data to send as JSON
   * @returns {AetherContext} - Chainable
   */
  json(data) {
    if (this._terminated) return this;
    
    this.setHeader("Content-Type", "application/json; charset=utf-8");
    
    // [PERF] Fast JSON stringification check
    if (typeof data === "object") {
      this._body = JSON.stringify(data);
    } else {
      this._body = String(data);
    }
    
    this._finalize();
    return this;
  }
  
  /**
   * Send text response
   * @param {string} data - Text to send
   * @returns {AetherContext} - Chainable
   */
  text(data) {
    if (this._terminated) return this;
    
    this.setHeader("Content-Type", "text/plain; charset=utf-8");
    this._body = String(data);
    this._finalize();
    return this;
  }
  
  /**
   * Send raw response (no content-type header)
   * @param {any} data - Raw data to send
   * @returns {AetherContext} - Chainable
   */
  raw(data) {
    if (this._terminated) return this;
    this._body = data;
    this._finalize();
    return this;
  }
  
  // ==========================================
  // [PERF] STATE MANAGEMENT
  // ==========================================
  
  /**
   * Set state value (for middleware communication)
   * @param {string} key - State key
   * @param {any} value - State value
   * @returns {AetherContext} - Chainable
   */
  setState(key, value) {
    this._stateObj[key] = value;
    return this;
  }
  
  /**
   * Get state value
   * @param {string} key - State key
   * @returns {any} - State value
   */
  getState(key) {
    return this._stateObj[key];
  }
  
  /**
   * Check if response has been sent
   * @returns {boolean} - True if terminated
   */
  isTerminated() {
    return this._terminated;
  }
  
  // ==========================================
  // [PERF] RESPONSE FINALIZATION
  // ==========================================
  
  /**
   * Finalize and send response
   * @private
   */
  _finalize() {
    if (this._terminated) return;
    this._terminated = true;
    
    const res = this._response;
    if (!res || res.headersSent) return;
    
    // [PERF] Build headers object directly (faster than array manipulation)
    const headers = {};
    
    // [PERF] Manual header iteration without Object.keys()
    for (let i = 0; i < this._headersCount; i++) {
      const key = this._headersKeys[i];
      const val = this._headersObj[key];
      if (val !== undefined) {
        headers[key] = val;
      }
    }
    
    // [PERF] Set keep-alive header if not already set
    if (!headers["connection"]) {
      headers["connection"] = "keep-alive";
    }
    
    // [PERF] Direct writeHead call without extra checks
    res.writeHead(this.statusCode, headers);
    
    // [PERF] Direct end call (Node.js handles socket optimization internally)
    if (this._body !== null) {
      res.end(this._body);
    } else {
      res.end();
    }
  }
}

export default AetherContext;
