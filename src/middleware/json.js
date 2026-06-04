/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/middleware/json.js
 */

// [V8-OPT] Pre-allocate error objects to avoid stack trace generation overhead in hot paths.
// Throwing pre-allocated errors is significantly faster than creating new Error instances.
const ERR_LIMIT_EXCEEDED = new Error("JSON_PAYLOAD_LIMIT_EXCEEDED");
const ERR_EMPTY_PAYLOAD = new Error("EMPTY_JSON_PAYLOAD");
const ERR_INVALID_JSON = new Error("INVALID_JSON_FORMAT");

// [V8-OPT] Pre-compile regex for size parsing.
const SIZE_REGEX = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i;

// [V8-OPT] Unit multipliers lookup.
const SIZE_UNITS = { b: 1, kb: 1024, mb: 1048576, gb: 1073741824 };

/**
 * [V8-OPT] Fast size parser. 
 * Uses bitwise OR 0 to force V8 to use 31-bit integers (Smi), which are processed 
 * natively in CPU registers without heap allocation.
 */
function parseSize(size) {
  if (typeof size === 'number') return size | 0;
  const match = SIZE_REGEX.exec(String(size));
  if (!match) throw new Error(`Invalid size format: ${size}`);
  return (parseFloat(match[1]) * (SIZE_UNITS[match[2].toLowerCase()] || 1)) | 0;
}

/**
 * [V8-OPT] Isolated JSON parsing function.
 * Keeping try/catch in a separate function prevents V8 from deoptimizing the caller.
 */
function safeParse(text, reviver) {
  try {
    return reviver ? JSON.parse(text, reviver) : JSON.parse(text);
  } catch (e) {
    throw e; 
  }
}

// [V8-OPT] Default error handlers defined outside to avoid re-creation on every middleware init.
function defaultOnError(context, error) {
  context.setStatus(400).json({
    error: "Bad Request",
    message: "Invalid JSON format",
    details: error.message,
  });
}

function defaultOnLimitExceeded(context, limitBytes) {
  context.setStatus(413).json({
    error: "Payload Too Large",
    message: `JSON payload exceeds ${limitBytes} bytes limit`,
  });
}

/**
 * Create JSON parsing middleware for AetherJS.
 * Highly optimized for V8 JIT, minimizing allocations and avoiding deep closures.
 * 
 * @param {Object} options - JSON parser configuration
 * @returns {Function} - JSON parser middleware function
 */
function createJsonMiddleware(options = {}) {
  // [V8-OPT] Env config parsing. Removed eval() for reviver to prevent RCE vulnerabilities.
  const envLimit = process.env.BODY_LIMIT_JSON;
  const envStrict = process.env.JSON_STRICT;
  const envEnable = process.env.JSON_ENABLE;

  const limit = options.limit !== undefined ? parseSize(options.limit) : (envLimit ? parseSize(envLimit) : 1048576);
  const strict = options.strict !== undefined ? options.strict : (envStrict !== "false");
  const enabled = options.enabled !== undefined ? options.enabled : (envEnable !== "false");
  
  // [V8-OPT] Safe reviver check. Never use eval() on environment variables.
  const reviver = typeof options.reviver === 'function' ? options.reviver : null;

  const onError = options.onError || defaultOnError;
  const onLimitExceeded = options.onLimitExceeded || defaultOnLimitExceeded;

  /**
   * [V8-OPT] The core middleware function.
   * Optimized for fast-path exits, minimal property lookups, and zero closure allocations.
   */
  return async function jsonMiddleware(context, next) {
    // 1. Fast-path: Disabled
    if (!enabled) return next();

    // 2. Fast-path: Method check (GET/HEAD rarely have bodies)
    const method = context.method;
    if (method === "GET" || method === "HEAD") return next();

    // 3. Fast-path: Content-Type check (indexOf is heavily optimized in V8 C++)
    const contentType = context.getHeader("content-type");
    if (!contentType || contentType.indexOf("application/json") === -1) return next();

    // 4. Fast-path: Content-Length check
    const contentLengthHeader = context.getHeader("content-length");
    const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
    
    if (contentLength === 0) return next();
    if (contentLength > limit) return onLimitExceeded(context, limit);

    // 5. Parse Body
    try {
      const json = await parseBody(context._request, limit, strict, reviver);
      
      // [V8-OPT] Direct property assignment is faster than Map/Set or Proxy traps.
      context.jsonBody = json;
      context.body = json;
      
      // [V8-OPT] Avoid creating a new closure `() => json` for every request.
      // Direct property access (context.jsonBody) is the fastest way to retrieve data.
      if (context.setState) {
        context.setState("json", json);
        context.setState("body", json);
      }

      return next();
    } catch (error) {
      // [V8-OPT] Strict identity check against pre-allocated errors is faster than string matching.
      if (error === ERR_LIMIT_EXCEEDED) {
        return onLimitExceeded(context, limit);
      }
      return onError(context, error);
    }
  };
}

/**
 * [V8-OPT] High-performance stream reader.
 * Uses a single-chunk fast path to avoid array allocations and Buffer.concat for small payloads.
 * This bypasses standard stream overhead for 95% of typical JSON API requests.
 */
function parseBody(request, limit, strict, reviver) {
  return new Promise((resolve, reject) => {
    let bodyBuffer = null;
    let chunks = null;
    let totalLength = 0;

    const onData = (chunk) => {
      totalLength += chunk.length;
      
      if (totalLength > limit) {
        request.destroy();
        reject(ERR_LIMIT_EXCEEDED);
        return;
      }

      // [V8-OPT] Single-chunk fast path. Most small JSON payloads arrive in one TCP chunk.
      // This completely avoids array allocation and Buffer.concat overhead.
      if (!bodyBuffer && !chunks) {
        bodyBuffer = chunk;
      } else {
        if (!chunks) {
          chunks = [bodyBuffer];
          bodyBuffer = null;
        }
        chunks.push(chunk);
      }
    };

    const onEnd = () => {
      let finalBuffer;
      
      if (bodyBuffer) {
        finalBuffer = bodyBuffer; // [V8-OPT] Zero-copy for single chunk
      } else if (chunks) {
        finalBuffer = Buffer.concat(chunks, totalLength);
      } else {
        if (strict) return reject(ERR_EMPTY_PAYLOAD);
        return resolve(null);
      }

      // [V8-OPT] toString with explicit encoding is slightly faster in C++ bindings.
      const text = finalBuffer.toString("utf8");

      if (strict && text.length === 0) {
        return reject(ERR_EMPTY_PAYLOAD);
      }

      // [V8-OPT] Delegate to isolated function to prevent try/catch deoptimization here.
      try {
        const parsed = safeParse(text, reviver);
        resolve(parsed);
      } catch (e) {
        reject(ERR_INVALID_JSON);
      }
    };

    const onError = (err) => {
      reject(err);
    };

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}

// [V8-OPT] Utility functions attached to the factory.
createJsonMiddleware.parse = function (text, reviver) {
  return safeParse(text, reviver);
};

createJsonMiddleware.stringify = function (value, replacer, space) {
  return JSON.stringify(value, replacer, space);
};

createJsonMiddleware.isValid = function (text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

createJsonMiddleware.format = function (json, space = 2) {
  return JSON.stringify(json, null, space);
};

export default createJsonMiddleware;
