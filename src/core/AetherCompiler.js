 /**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/core/AetherComplier
 */
class AetherCompiler {
  constructor(options = {}) {
    this.cache = new Map();
    this.maxCacheSize = options.maxCacheSize || 128;
  }

  /**
   * Compile middleware chain into high-speed execution unit
   */
  compile(middlewares) {
    const cacheKey = this._generateCacheKey(middlewares);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const compiledFn = this._compileChain(middlewares);

    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(cacheKey, compiledFn);

    return compiledFn;
  }

  _generateCacheKey(middlewares) {
    // Generate absolutely precise and fast cache keys using unique reference identifiers
    let key = "";
    for (let i = 0; i < middlewares.length; i++) {
      key +=
        (middlewares[i]._id ||
          (middlewares[i]._id = Math.random().toString(36).substring(2))) + "|";
    }
    return key;
  }

  /**
   * Ultimate compilation core: Completely strip signal closure allocation, use lossless index state machine pointers for iteration
   */
  _compileChain(middlewares) {
    const len = middlewares.length;

    if (len === 0) {
      return function (context) {
        context._finalize();
      };
    }

    // Check if the entire chain is purely synchronous (no async/await/promise)
    const isAllSync = middlewares.every((mw) => {
      const str = mw.toString();
      return (
        !str.includes("async ") &&
        !str.includes(".then") &&
        !str.includes("await ")
      );
    });

    // Path 1: Fully synchronous chain → Use the fastest flat `for` loop sequential execution with no extra function stack depth
    if (isAllSync) {
      return function executePureSyncChain(context) {
        for (let i = 0; i < len; i++) {
          middlewares[i](context, null); // No need to care about traditional next parameter passing in synchronous state
          if (context.isTerminated()) return;
        }
        context._finalize();
      };
    }

    // Path 2: Contains asynchronous chain → Strip closures. Achieve zero object allocation iteration by dynamically simulating 'state pointers' at runtime
    return function executeAsyncChain(context) {
      let index = 0;

      // Reuse single-stack function, never allocate closures like `() => next()` for each middleware
      function next() {
        if (index >= len) {
          if (!context.isTerminated()) context._finalize();
          return Promise.resolve();
        }

        if (context.isTerminated()) return Promise.resolve();

        const currMiddleware = middlewares[index++];
        try {
          const result = currMiddleware(context, next);

          // Compatibility handling: If it's a Promise, mount subsequent chain; if synchronous return, directly accelerate progression
          if (result && typeof result.then === "function") {
            return result.then(next);
          }
          return next();
        } catch (err) {
          return Promise.reject(err);
        }
      }

      return next();
    };
  }

  clearCache() {
    this.cache.clear();
  }
}

// Maintain factory export format
function createAetherCompiler(options = {}) {
  return new AetherCompiler(options);
}

export default createAetherCompiler;
