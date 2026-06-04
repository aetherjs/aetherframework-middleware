/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/middleware/compression
 */

import zlib from "zlib";

/**
 * Parses a comma-separated string of MIME types into an array.
 * Falls back to a default list of common compressible text-based types if none is provided.
 *
 * @param {string} types - Comma-separated list of content types.
 * @returns {Array<string>} - Array of trimmed content type strings.
 */
function parseCompressionTypes(types) {
  if (!types || typeof types !== "string") {
    return [
      "text/plain",
      "text/html",
      "text/css",
      "application/javascript",
      "application/json",
      "application/xml",
      "text/xml",
      "application/xhtml+xml",
      "text/javascript",
    ];
  }

  return types
    .split(",")
    .map((type) => type.trim())
    .filter(Boolean);
}

/**
 * Checks if a given content type should be compressed based on the allowed list.
 *
 * @param {string} contentType - The response content type.
 * @param {Array<string>} compressibleTypes - List of compressible MIME types.
 * @returns {boolean} - True if the content type is compressible.
 */
function shouldCompress(contentType, compressibleTypes) {
  if (!contentType) return false;

  for (const type of compressibleTypes) {
    if (contentType.includes(type)) {
      return true;
    }
  }

  return false;
}

/**
 * Creates the compression middleware for AetherJS.
 * Intercepts the underlying Node.js `res.end` method to compress response bodies
 * dynamically based on client Accept-Encoding headers and configured thresholds.
 *
 * @param {Object} options - Compression configuration options.
 * @returns {Function} - The compression middleware function.
 */
function createCompressionMiddleware(options = {}) {
  // Load configuration from environment variables
  const envConfig = {
    enabled: process.env.COMPRESSION_ENABLED,
    threshold: process.env.COMPRESSION_THRESHOLD,
    level: process.env.COMPRESSION_LEVEL,
    memLevel: process.env.COMPRESSION_MEM_LEVEL,
    strategy: process.env.COMPRESSION_STRATEGY,
    chunkSize: process.env.COMPRESSION_CHUNK_SIZE,
    windowBits: process.env.COMPRESSION_WINDOW_BITS,
    gzip: process.env.COMPRESSION_GZIP,
    deflate: process.env.COMPRESSION_DEFLATE,
    brotli: process.env.COMPRESSION_BROTLI,
    types: process.env.COMPRESSION_TYPES,
  };

  // Define default configuration values
  // compression.js

  const defaults = {
    enabled: envConfig.enabled === "true",

    threshold: parseInt(envConfig.threshold) || 1024,
    level: parseInt(envConfig.level) || zlib.constants.Z_DEFAULT_COMPRESSION,
    memLevel: parseInt(envConfig.memLevel) || 8,
    strategy: parseInt(envConfig.strategy) || zlib.constants.Z_DEFAULT_STRATEGY,
    chunkSize: parseInt(envConfig.chunkSize) || 16 * 1024,
    windowBits: parseInt(envConfig.windowBits) || 15,

    gzip: envConfig.gzip === "true",
    deflate: envConfig.deflate === "true",
    brotli:
      envConfig.brotli === "true" &&
      typeof zlib.createBrotliCompress === "function",

    types: parseCompressionTypes(envConfig.types),
    filter: (contentType) =>
      shouldCompress(contentType, parseCompressionTypes(envConfig.types)),
  };

  // Merge default configuration with user-provided options
  const config = { ...defaults, ...options };

  // Configure zlib options for Gzip and Deflate
  const zlibOptions = {
    level: config.level,
    memLevel: config.memLevel,
    strategy: config.strategy,
    chunkSize: config.chunkSize,
    windowBits: config.windowBits,
  };

  // Configure Brotli specific parameters
  const brotliOptions = {
    params: {
      // Brotli quality 4 is a good default for web if level is -1 (default)
      [zlib.constants.BROTLI_PARAM_QUALITY]:
        config.level === -1 ? 4 : config.level,
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: config.chunkSize,
    },
  };

  /**
   * Compresses a data buffer using the specified encoding algorithm.
   *
   * @param {Buffer} data - The raw data buffer to compress.
   * @param {string} encoding - The compression algorithm ('gzip', 'deflate', or 'br').
   * @returns {Promise<Buffer>} - A promise that resolves with the compressed buffer.
   */
  async function compressData(data, encoding) {
    return new Promise((resolve, reject) => {
      let compressor;

      switch (encoding) {
        case "gzip":
          compressor = zlib.createGzip(zlibOptions);
          break;
        case "deflate":
          compressor = zlib.createDeflate(zlibOptions);
          break;
        case "br":
          if (!config.brotli) {
            return reject(
              new Error(
                "Brotli compression is not supported in this environment",
              ),
            );
          }
          compressor = zlib.createBrotliCompress(brotliOptions);
          break;
        default:
          return reject(
            new Error(`Unsupported compression encoding: ${encoding}`),
          );
      }

      const chunks = [];
      compressor.on("data", (chunk) => chunks.push(chunk));
      compressor.on("end", () => resolve(Buffer.concat(chunks)));
      compressor.on("error", reject);

      compressor.write(data);
      compressor.end();
    });
  }

  /**
   * The core middleware function that hooks into the response lifecycle.
   *
   * @param {Object} context - The AetherJS execution context.
   * @param {Object|Function} signal - The signal object or next function for pipeline flow control.
   */
  return async function compressionMiddleware(context, signal) {
    // Safe invoker for compatible pipeline flow control
    const invokeNext = async () => {
      if (signal && typeof signal.next === "function") {
        await signal.next();
      } else if (typeof signal === "function") {
        await signal();
      }
    };

    // Bypass middleware if compression is disabled
    if (!config.enabled) {
      return await invokeNext();
    }

    // Retrieve the underlying native Node.js HTTP response object
    const res = context.res || context.rawRes;

    // If native response object is not available, bypass compression
    if (!res || typeof res.end !== "function") {
      return await invokeNext();
    }

    // Prevent multiple hooks on the same response object
    if (res._compressionHooked) {
      return await invokeNext();
    }
    res._compressionHooked = true;

    // Store the original res.end method to call after compression
    const originalEnd = res.end;

    // Override res.end to intercept the response body before it is sent to the client
    res.end = function (chunk, encoding, callback) {
      // If headers are already sent, stream is ended, or no chunk is provided, bypass compression
      if (res.writableEnded || res.headersSent || !chunk) {
        return originalEnd.call(res, chunk, encoding, callback);
      }

      // Determine the response content type
      let contentType = "";
      if (typeof res.getHeader === "function") {
        contentType = res.getHeader("content-type") || "";
      } else if (typeof context.getHeader === "function") {
        contentType = context.getHeader("content-type") || "";
      }

      // Check if the content type is eligible for compression
      if (!config.filter(contentType)) {
        return originalEnd.call(res, chunk, encoding, callback);
      }

      // Convert the chunk to a Buffer for accurate size checking and compression
      const bodyBuffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk, typeof encoding === "string" ? encoding : "utf8");

      // Bypass compression if the body size is below the configured threshold
      if (bodyBuffer.length < config.threshold) {
        return originalEnd.call(res, chunk, encoding, callback);
      }

      // Extract accepted encodings from the incoming request headers
      let acceptEncoding = "";
      if (context.req && context.req.headers) {
        acceptEncoding = context.req.headers["accept-encoding"] || "";
      } else if (typeof context.getHeader === "function") {
        acceptEncoding = context.getHeader("accept-encoding") || "";
      }

      // Determine the best compression algorithm based on client support (Priority: Brotli > Gzip > Deflate)
      let chosenEncoding = null;
      if (config.brotli && acceptEncoding.includes("br")) {
        chosenEncoding = "br";
      } else if (config.gzip && acceptEncoding.includes("gzip")) {
        chosenEncoding = "gzip";
      } else if (config.deflate && acceptEncoding.includes("deflate")) {
        chosenEncoding = "deflate";
      }

      // If no supported encoding is accepted by the client, bypass compression
      if (!chosenEncoding) {
        return originalEnd.call(res, chunk, encoding, callback);
      }

      // Perform asynchronous compression
      compressData(bodyBuffer, chosenEncoding)
        .then((compressed) => {
          // Update response headers to reflect the compressed content
          res.setHeader("content-encoding", chosenEncoding);

          // Append 'Accept-Encoding' to the Vary header to ensure proper proxy/browser caching
          const varyHeader = res.getHeader("vary");
          if (varyHeader) {
            res.setHeader("vary", `${varyHeader}, Accept-Encoding`);
          } else {
            res.setHeader("vary", "Accept-Encoding");
          }

          // Remove content-length as the compressed size is different from the original
          res.removeHeader("content-length");

          // Send the compressed buffer using the original end method
          originalEnd.call(res, compressed, null, callback);
        })
        .catch((error) => {
          // Fallback to original body if compression fails to prevent broken responses
          console.error(
            "[Compression] Error during compression, falling back to original body:",
            error,
          );
          originalEnd.call(res, chunk, encoding, callback);
        });
    };

    await invokeNext();
  };
}

export default createCompressionMiddleware;
