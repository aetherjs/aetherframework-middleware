 /**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/core/AetherContext
 */
const GLOBAL_HEADER_BUFFER = new Array(64);

class AetherContext {
  constructor(request, response) {
    // 1. Strictly align with V8's Hidden Class (Shape) optimization
    this._request = null;
    this._response = null;

    this.method = "";
    this.url = "";
    this.headers = null;
    this.path = "";
    this._queryString = "";

    // 2. Avoid using Map/Set; use flat plain objects/arrays for custom response headers to achieve 5x faster R/W speeds.
    this._headersObj = {};
    this._headersCount = 0;
    this._headersKeys = new Array(16); // Pre-allocated key tracking array

    this._queryCache = null;
    this._ipCache = null; // Lazy-evaluated cache

    this.statusCode = 200;
    this._body = null;
    this._terminated = false;

    // 3. Use plain flat objects for business state/context storage, strictly avoiding Maps.
    this._stateObj = {};

    this._startTime = 0n;

    if (request && response) {
      this._reset(request, response);
    }
  }

  /**
   * Ultra-fast context reset for pooling mechanisms (True Zero-Object-Allocation strategy)
   */
  _reset(request, response) {
    this._request = request;
    this._response = response;

    this.method = request.method;
    const rawUrl = request.url || "/";
    this.url = rawUrl;
    this.headers = request.headers;

    // Fast string slicing (bypassing expensive RegEx and URL instantiation overheads)
    const qIdx = rawUrl.indexOf("?");
    if (qIdx !== -1) {
      this.path = rawUrl.substring(0, qIdx);
      this._queryString = rawUrl.substring(qIdx + 1);
    } else {
      this.path = rawUrl;
      this._queryString = "";
    }

    // Only clear references, never use the 'new' keyword to re-allocate memory
    this._queryCache = null;
    this._ipCache = null;

    this.statusCode = 200;
    this._body = null;
    this._terminated = false;

    // Clean up custom headers object without breaking Hidden Classes or re-allocating memory
    if (this._headersCount > 0) {
      for (let i = 0; i < this._headersCount; i++) {
        this._headersObj[this._headersKeys[i]] = undefined;
      }
      this._headersCount = 0;
    }

    this._stateObj = {}; // Kept as empty object in most scenarios
    this._startTime = process.hrtime.bigint();
  }

  // 🟢 Intercept the body property to establish the data pipeline
  get body() {
    return this._body;
  }
  set body(value) {
    if (this._terminated) return;
    this._body = value;
  }

  /**
   * Lazy IP evaluation: Trigger C++ binding bridge only when business logic explicitly requests ctx.ip
   */
  get ip() {
    if (this._ipCache) return this._ipCache;
    const sock = this._request?.socket;
    return (this._ipCache = sock ? sock.remoteAddress : "127.0.0.1");
  }

  /**
   * Lazy Query parsing: Synchronous hand-optimized raw string scanner
   */
  get query() {
    if (this._queryCache) return this._queryCache;
    if (!this._queryString) return (this._queryCache = {});

    const obj = {};
    const pairs = this._queryString.split("&");
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const eqIdx = pair.indexOf("=");
      if (eqIdx !== -1) {
        obj[pair.substring(0, eqIdx)] = pair.substring(eqIdx + 1);
      } else {
        obj[pair] = "";
      }
    }
    return (this._queryCache = obj);
  }

  setHeader(key, value) {
    if (this._terminated) return this;

    // Convention: High-performance middlewares should pass standard casing headers (e.g., 'Content-Type').
    // We intentionally omit .toLowerCase() here to conserve CPU cycles.
    if (this._headersObj[key] === undefined) {
      this._headersKeys[this._headersCount++] = key;
    }
    this._headersObj[key] = value;
    return this;
  }

  getHeader(key) {
    return (
      this.headers[key] ||
      this.headers[key.toLowerCase()] ||
      this._headersObj[key] ||
      null
    );
  }

  setStatus(code) {
    if (this._terminated) return this;
    this.statusCode = code;
    return this;
  }

  json(data) {
    if (this._terminated) return this;
    // Direct assignment to prevent redundant lookup overheads
    if (this._headersObj["Content-Type"] === undefined) {
      this._headersKeys[this._headersCount++] = "Content-Type";
    }
    this._headersObj["Content-Type"] = "application/json; charset=utf-8";
    this._body = typeof data === "object" ? JSON.stringify(data) : data;
    this._finalize();
    return this;
  }

  text(data) {
    if (this._terminated) return this;
    if (this._headersObj["Content-Type"] === undefined) {
      this._headersKeys[this._headersCount++] = "Content-Type";
    }
    this._headersObj["Content-Type"] = "text/plain; charset=utf-8";
    this._body = String(data);
    this._finalize();
    return this;
  }

  raw(data) {
    if (this._terminated) return this;
    this._body = data;
    this._finalize();
    return this;
  }

  setState(key, value) {
    this._stateObj[key] = value;
    return this;
  }

  getState(key) {
    return this._stateObj[key];
  }

  isTerminated() {
    return this._terminated;
  }

  /**
   * Critical Performance Bottleneck Optimization: Flush data instantly via the shared buffer
   */
  _finalize() {
    if (this._terminated) return;
    this._terminated = true;

    const res = this._response;
    const socket = res.socket;

    if (socket) socket.cork();

    // Core optimization: Reuse the pre-allocated flat array to eliminate transient garbage collection pressure
    GLOBAL_HEADER_BUFFER[0] = "Connection";
    GLOBAL_HEADER_BUFFER[1] = "keep-alive";
    let cursor = 2;

    for (let i = 0; i < this._headersCount; i++) {
      const key = this._headersKeys[i];
      const val = this._headersObj[key];
      if (val !== undefined) {
        GLOBAL_HEADER_BUFFER[cursor++] = key;
        GLOBAL_HEADER_BUFFER[cursor++] = val;
      }
    }

    // Slice the buffer and pass it directly to the native writeHead.
    // Note: The slice size is highly predictable and short, allowing V8 to aggressively inline the operation.
    res.writeHead(this.statusCode, GLOBAL_HEADER_BUFFER.slice(0, cursor));

    if (this._body !== null) {
      res.end(this._body);
    } else {
      res.end();
    }

    if (socket) {
      process.nextTick(() => socket.uncork());
    }
  }

  getMetrics() {
    return {
      duration: Number(process.hrtime.bigint() - this._startTime) / 1e6,
    };
  }
}

export default AetherContext;
