
/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/middleware/cors.js
 */

function parseOrigin(origin) {
  if (origin === "*") {
    return (requestOrigin) => "*";
  }

  if (typeof origin === "string") {
    const origins = origin
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    if (origins.length === 1) {
      const singleOrigin = origins[0];
      return (requestOrigin) => {
        if (singleOrigin === "*") return "*";
        return requestOrigin === singleOrigin ? requestOrigin : null;
      };
    }
    return (requestOrigin) =>
      origins.includes(requestOrigin) ? requestOrigin : null;
  }

  if (Array.isArray(origin)) {
    return (requestOrigin) =>
      origin.includes(requestOrigin) ? requestOrigin : null;
  }

  if (typeof origin === "function") {
    return origin;
  }

  return () => null;
}

function createCorsMiddleware(options = {}) {
  const envConfig = {
    enabled: process.env.CORS_ENABLED,
    origin: process.env.CORS_ORIGIN,
    methods: process.env.CORS_METHODS,
    allowedHeaders: process.env.CORS_ALLOWED_HEADERS,
    credentials: process.env.CORS_CREDENTIALS,
    maxAge: process.env.CORS_MAX_AGE,
    preflightContinue: process.env.CORS_PREFLIGHT_CONTINUE,
    optionsSuccessStatus: process.env.CORS_OPTIONS_STATUS,
  };

  const defaults = {
    enabled: envConfig.enabled !== "false",
    origin: envConfig.origin || "*",
    methods: envConfig.methods
      ? envConfig.methods.split(",").map((m) => m.trim())
      : ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: envConfig.allowedHeaders
      ? envConfig.allowedHeaders.split(",").map((h) => h.trim())
      : ["Content-Type", "Authorization"],
    exposedHeaders: [],
    credentials: envConfig.credentials === "true",
    maxAge: envConfig.maxAge ? parseInt(envConfig.maxAge) : 86400,
    preflightContinue: envConfig.preflightContinue === "true",
    optionsSuccessStatus: envConfig.optionsSuccessStatus
      ? parseInt(envConfig.optionsSuccessStatus)
      : 204,
  };

  const config = { ...defaults, ...options };
  const originValidator = parseOrigin(config.origin);
  const staticHeaders = new Map();

  if (config.methods && config.methods.length > 0) {
    staticHeaders.set(
      "access-control-allow-methods",
      config.methods.join(", "),
    );
  }
  if (config.allowedHeaders && config.allowedHeaders.length > 0) {
    staticHeaders.set(
      "access-control-allow-headers",
      config.allowedHeaders.join(", "),
    );
  }
  if (config.maxAge && config.maxAge > 0) {
    staticHeaders.set("access-control-max-age", config.maxAge.toString());
  }
  if (config.exposedHeaders && config.exposedHeaders.length > 0) {
    staticHeaders.set(
      "access-control-expose-headers",
      config.exposedHeaders.join(", "),
    );
  }

  return async function corsMiddleware(context, signal) {
    if (!config.enabled) {
      return signal && signal.next
        ? await signal.next()
        : typeof signal === "function"
          ? await signal()
          : void 0;
    }

    const requestOrigin = context.getHeader("origin") || "";
    let allowOrigin = originValidator(requestOrigin);

    // 💡 Critical Fix: According to W3C specs, if credentials are enabled and origin is '*',
    // we must dynamically mirror the incoming request origin instead of returning a literal '*'.
    if (config.credentials && allowOrigin === "*") {
      allowOrigin = requestOrigin || "*";
    }

    if (allowOrigin && allowOrigin !== null) {
      context.setHeader("access-control-allow-origin", allowOrigin);

      for (const [header, value] of staticHeaders) {
        context.setHeader(header, value);
      }

      if (config.credentials) {
        context.setHeader("access-control-allow-credentials", "true");
      }

      if (allowOrigin !== "*") {
        const varyHeader = context.getHeader("vary");
        const varyValues = varyHeader
          ? varyHeader.split(",").map((v) => v.trim())
          : [];
        if (!varyValues.includes("Origin")) {
          varyValues.push("Origin");
          context.setHeader("vary", varyValues.join(", "));
        }
      }
    }

    // Handle CORS Preflight OPTIONS requests
    if (context.method === "OPTIONS") {
      if (!config.preflightContinue) {
        context.setStatus(config.optionsSuccessStatus);
        context.setHeader("content-length", "0");
        if (typeof context.json === "function") {
          context.json("");
        } else {
          context.raw("");
        }
        return; // Short-circuit the request pipeline instantly, bypassing signal.next()
      }
    }

    // Backward compatibility: Supports either signal.next() or traditional functional next() dispatching
    if (signal && typeof signal.next === "function") {
      await signal.next();
    } else if (typeof signal === "function") {
      await signal();
    }
  };
}

export default createCorsMiddleware;
