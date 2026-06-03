/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/middleware/security.js
 */


function parsePermissionsPolicy(directivesString) {
  if (!directivesString || typeof directivesString !== "string") {
    return null;
  }
  const directives = {};
  const pairs = directivesString.split(/[,;]/);
  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex !== -1) {
      const feature = trimmed.substring(0, equalIndex).trim();
      const value = trimmed.substring(equalIndex + 1).trim();
      if (feature && value) directives[feature] = value;
    }
  }
  return Object.keys(directives).length > 0 ? directives : null;
}

/**
 * Create security headers middleware for AetherJS
 * @param {Object} options - Security headers configuration
 * @returns {Function} - Standard AetherJS middleware (ctx, next)
 */
function createSecurityMiddleware(options = {}) {
  const envConfig = {
    hstsEnabled: process.env.SECURITY_HSTS_ENABLED,
    hstsMaxAge: process.env.SECURITY_HSTS_MAX_AGE,
    noSniffEnabled: process.env.SECURITY_NO_SNIFF,
    xssFilterEnabled: process.env.SECURITY_XSS_FILTER,
    frameguardAction: process.env.SECURITY_FRAMEGUARD_ACTION,
    hidePoweredBy: process.env.SECURITY_HIDE_POWERED_BY,
    referrerPolicy: process.env.SECURITY_REFERRER_POLICY,
  };

  const defaults = {
    hsts: {
      enabled: envConfig.hstsEnabled !== "false",
      maxAge: envConfig.hstsMaxAge ? parseInt(envConfig.hstsMaxAge) : 31536000,
      includeSubDomains: true,
      preload: false,
    },
    noSniff: { enabled: envConfig.noSniffEnabled !== "false" },
    xssFilter: { enabled: envConfig.xssFilterEnabled !== "false" },
    frameguard: { enabled: true, action: envConfig.frameguardAction || "DENY" },
    hidePoweredBy: envConfig.hidePoweredBy !== "false",
    referrerPolicy: {
      enabled: true,
      value: envConfig.referrerPolicy || "strict-origin-when-cross-origin",
    },
    permissionsPolicy: {
      enabled: true,
      directives: { camera: "()", microphone: "()", geolocation: "()" },
    },
  };

  // Deep merge simple version for performance
  const config = { ...defaults, ...options };

  // 🚀 性能优化：预计算所有 Header 字符串，避免在请求响应循环中构造字符串
  const staticHeaders = [];

  if (config.hsts.enabled) {
    let val = `max-age=${config.hsts.maxAge}${config.hsts.includeSubDomains ? "; includeSubDomains" : ""}${config.hsts.preload ? "; preload" : ""}`;
    staticHeaders.push(["Strict-Transport-Security", val]);
  }
  if (config.noSniff.enabled)
    staticHeaders.push(["X-Content-Type-Options", "nosniff"]);
  if (config.xssFilter.enabled)
    staticHeaders.push(["X-XSS-Protection", "1; mode=block"]);
  if (config.frameguard.enabled)
    staticHeaders.push([
      "X-Frame-Options",
      config.frameguard.action.toUpperCase(),
    ]);
  if (config.referrerPolicy.enabled)
    staticHeaders.push(["Referrer-Policy", config.referrerPolicy.value]);
  if (config.permissionsPolicy.enabled) {
    const p = Object.entries(config.permissionsPolicy.directives)
      .map(([f, v]) => `${f}=${v}`)
      .join(", ");
    staticHeaders.push(["Permissions-Policy", p]);
  }

  /**
   * 💡 修复后的核心中间件函数
   * 使用 (context, next) 签名替代旧版的 (context, signal)
   */
  return async function securityMiddleware(context, next) {
    console.log("Security middleware executing for URL:", context.url);
    // 1. 批量写入预计算的 Header
    for (let i = 0; i < staticHeaders.length; i++) {
      context.setHeader(staticHeaders[i][0], staticHeaders[i][1]);
    }

    // 2. 移除敏感 Header
    if (config.hidePoweredBy && context._response) {
      context._response.removeHeader("X-Powered-By");
    }

    // 3. 💡 修复点：调用标准 next() 而不是 signal.next()
    if (typeof next === "function") {
      return next();
    }
  };
}

export default createSecurityMiddleware;
