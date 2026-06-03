
/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/middleware/json.js
 */
/**
 * Create JSON parsing middleware for AetherJS
 * @param {Object} options - JSON parser configuration
 * @returns {Function} - JSON parser middleware function
 */
function createJsonMiddleware(options = {}) {
  // Load configuration from environment variables
  const envConfig = {
    limit: process.env.BODY_LIMIT_JSON,
    strict: process.env.JSON_STRICT,
    reviver: process.env.JSON_REVIVER,
    enable: process.env.JSON_ENABLE,
  };

  // Default configuration
  const defaults = {
    enabled: envConfig.enable !== "false",
    limit: parseSize(envConfig.limit || "1mb"),
    strict: envConfig.strict !== "false",
    reviver: envConfig.reviver ? eval(`(${envConfig.reviver})`) : null,

    // Error handling
    onError: (context, error) => {
      context.setStatus(400).json({
        error: "Bad Request",
        message: "Invalid JSON format",
        details: error.message,
      });
    },

    // Size limit exceeded handler
    onLimitExceeded: (context, limit) => {
      context.setStatus(413).json({
        error: "Payload Too Large",
        message: `JSON payload exceeds ${limit} bytes limit`,
      });
    },
  };

  // Parse size string to bytes
  function parseSize(size) {
    const units = {
      b: 1,
      kb: 1024,
      mb: 1024 * 1024,
      gb: 1024 * 1024 * 1024,
    };

    // 1. 确保 size 是字符串，并转换为小写以便匹配
    const lowerSize = String(size).toLowerCase();

    // 2. 执行正则匹配
    const match = lowerSize.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/);

    if (!match) {
      throw new Error(`Invalid size format: ${size}`);
    }

    // 3. 从匹配数组中提取数值部分 (index 1) 和单位部分 (index 2)
    const value = parseFloat(match[1]); // 提取第一个捕获组（数字）
    const unit = match[2]; // 提取第二个捕获组（单位）

    // 4. 计算并返回字节数
    return value * (units[unit] || 1);
  }

  // Merge with provided options
  const config = { ...defaults, ...options };

  /**
   * Parse JSON from request body
   * @param {Object} request - HTTP request object
   * @returns {Promise<Object>} - Parsed JSON object
   */
  async function parseJson(request) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let totalLength = 0;

      request.on("data", (chunk) => {
        totalLength += chunk.length;

        if (totalLength > config.limit) {
          request.destroy();
          reject(new Error(`JSON payload exceeds ${config.limit} bytes limit`));
          return;
        }

        chunks.push(chunk);
      });

      request.on("end", () => {
        try {
          const buffer = Buffer.concat(chunks);
          const text = buffer.toString("utf8");

          if (config.strict && text.trim() === "") {
            reject(new Error("Empty JSON payload"));
            return;
          }

          const parsed = config.reviver
            ? JSON.parse(text, config.reviver)
            : JSON.parse(text);

          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });

      request.on("error", (error) => {
        reject(error);
      });
    });
  }

  /**
 * JSON middleware function
 * @param {AetherContext} context - AetherJS execution context
 * @param {Function} next - Next middleware function
 */
return async function jsonMiddleware(context, next) {
  if (!config.enabled) {
    return typeof next === 'function' ? await next() : undefined;
  }

  // Skip if not JSON content type
  const contentType = context.getHeader("content-type") || "";
  if (!contentType.includes("application/json")) {
    return typeof next === 'function' ? await next() : undefined;
  }

  // Skip if no body is expected
  if (context.method === "GET" || context.method === "HEAD") {
    return typeof next === 'function' ? await next() : undefined;
  }

  const contentLength = parseInt(context.getHeader("content-length")) || 0;

  // Skip if no content
  if (contentLength === 0) {
    return typeof next === 'function' ? await next() : undefined;
  }

  // Check size limit
  if (contentLength > config.limit) {
    return config.onLimitExceeded(context, config.limit);
  }

  try {
    // Parse JSON body
    const json = await parseJson(context._request);

    // Store parsed JSON in context
    context.setState("json", json);
    context.setState("body", json);

    // Add JSON methods to context
    context.jsonBody = json;
    context.getJson = () => json;

    if (typeof next === 'function') {
      await next();
    }
  } catch (error) {
    if (error.message.includes("exceeds")) {
      return config.onLimitExceeded(context, config.limit);
    } else {
      return config.onError(context, error);
    }
  }
};

}

// Add utility functions to the middleware
createJsonMiddleware.parse = function (text, reviver) {
  try {
    return reviver ? JSON.parse(text, reviver) : JSON.parse(text);
  } catch (error) {
    throw new Error(`JSON parse error: ${error.message}`);
  }
};

createJsonMiddleware.stringify = function (value, replacer, space) {
  try {
    return JSON.stringify(value, replacer, space);
  } catch (error) {
    throw new Error(`JSON stringify error: ${error.message}`);
  }
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
