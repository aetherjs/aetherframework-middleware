
/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/middleware/compression.js
 */

import zlib from "zlib";

/**
 * Parse compression types from string
 * @param {string} types - Comma-separated list of content types
 * @returns {Array<string>} - Array of content types
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
 * Check if content type should be compressed
 * @param {string} contentType - Response content type
 * @param {Array<string>} compressibleTypes - List of compressible types
 * @returns {boolean} - Whether to compress
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
 * Create compression middleware for AetherJS
 * @param {Object} options - Compression configuration
 * @returns {Function} - Compression middleware function
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

  // Default configuration
  const defaults = {
    enabled: envConfig.enabled !== "false",
    threshold: parseInt(envConfig.threshold) || 1024,
    level: parseInt(envConfig.level) || zlib.constants.Z_DEFAULT_COMPRESSION,
    memLevel: parseInt(envConfig.memLevel) || 8,
    strategy: parseInt(envConfig.strategy) || zlib.constants.Z_DEFAULT_STRATEGY,
    chunkSize: parseInt(envConfig.chunkSize) || 16 * 1024,
    windowBits: parseInt(envConfig.windowBits) || 15,
    gzip: envConfig.gzip !== "false",
    deflate: envConfig.deflate === "true",
    brotli:
      envConfig.brotli === "true" &&
      typeof zlib.createBrotliCompress === "function",
    types: parseCompressionTypes(envConfig.types),
    filter: (contentType) =>
      shouldCompress(contentType, parseCompressionTypes(envConfig.types)),
  };

  // Merge with provided options
  const config = { ...defaults, ...options };

  // Create compression options
  const gzipOptions = {
    level: config.level,
    memLevel: config.memLevel,
    strategy: config.strategy,
    chunkSize: config.chunkSize,
    windowBits: config.windowBits,
  };

  const deflateOptions = { ...gzipOptions };
  const brotliOptions = {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: config.level,
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: config.chunkSize,
    },
  };

  /**
   * Compress data using specified algorithm
   * @param {Buffer} data - Data to compress
   * @param {string} encoding - Compression algorithm
   * @returns {Promise<Buffer>} - Compressed data
   */
  async function compressData(data, encoding) {
    return new Promise((resolve, reject) => {
      let compressor;

      switch (encoding) {
        case "gzip":
          compressor = zlib.createGzip(gzipOptions);
          break;
        case "deflate":
          compressor = zlib.createDeflate(deflateOptions);
          break;
        case "br":
          if (!config.brotli) {
            reject(new Error("Brotli compression not supported"));
            return;
          }
          compressor = zlib.createBrotliCompress(brotliOptions);
          break;
        default:
          reject(new Error(`Unsupported compression: ${encoding}`));
          return;
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
   * Compression middleware function
   * @param {AetherContext} context - AetherJS execution context
   * @param {Object} signal - Signal object or next function for flow control
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

    if (!config.enabled) {
      return await invokeNext();
    }

    // Store original finalize method
    const originalize = context._finalize;

    // Override finalize to add compression
    context._finalize = async function () {
      if (this._terminated) return;

      const body = this._body;

      // Safe fallback logic for grabbing the outbound content type
      let contentType = "";
      if (typeof this.getHeader === "function") {
        contentType = this.getHeader("content-type") || "";
      } else if (this._headers && typeof this._headers.get === "function") {
        contentType = this._headers.get("content-type") || "";
      }

      // Check if compression should be applied
      if (
        !body ||
        (!Buffer.isBuffer(body) && typeof body !== "string") ||
        Buffer.byteLength(body) < config.threshold ||
        !config.filter(contentType)
      ) {
        return originalize.call(this);
      }

      // Get accepted encodings
      const acceptEncoding =
        (typeof this.getHeader === "function"
          ? this.getHeader("accept-encoding")
          : "") || "";
      let encoding = null;

      // Determine best compression algorithm
      if (config.gzip && acceptEncoding.includes("gzip")) {
        encoding = "gzip";
      } else if (config.deflate && acceptEncoding.includes("deflate")) {
        encoding = "deflate";
      } else if (config.brotli && acceptEncoding.includes("br")) {
        encoding = "br";
      }

      if (!encoding) {
        return originalize.call(this);
      }

      try {
        // Convert body to buffer if needed
        const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body);

        // Compress data
        const compressed = await compressData(bodyBuffer, encoding);

        // Update response
        this._body = compressed;
        if (typeof this.setHeader === "function") {
          this.setHeader("content-encoding", encoding);
          this.setHeader("vary", "Accept-Encoding");
        }

        // Call original finalize
        return originalize.call(this);
      } catch (error) {
        // Compression failed, use original body
        console.error("Compression error:", error);
        return originalize.call(this);
      }
    };

    await invokeNext();
  };
}

export default createCompressionMiddleware;
