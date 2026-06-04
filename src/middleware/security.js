/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * @module @aetherframework/middleware/middleware/security.js
 */

// [V8-OPT] Ultra-fast boolean parser to prevent "false" string trap
function isEnvEnabled(key, defaultValue = false) {
  const val = process.env[key];
  if (val === undefined || val === null) return defaultValue;
  if (val === 'true' || val === '1') return true;
  if (val === 'false' || val === '0' || val === '') return false;
  return ['true', '1', 'yes', 'on'].includes(val.toLowerCase().trim());
}

function parsePermissionsPolicy(directivesString) {
  if (!directivesString || typeof directivesString !== "string") return null;
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

function createSecurityMiddleware(options = {}) {
  // [FIX] Strictly align with .env keys (removed 'SECURITY_' prefix and matched exact names)
  const defaults = {
    hsts: {
      enabled: isEnvEnabled('HSTS_ENABLED', false),
      maxAge: parseInt(process.env.HSTS_MAX_AGE) || 31536000,
      includeSubDomains: true,
      preload: false,
    },
    noSniff: { enabled: isEnvEnabled('X_CONTENT_TYPE_OPTIONS_ENABLED', false) },
    xssFilter: { enabled: isEnvEnabled('X_XSS_PROTECTION_ENABLED', false) },
    frameguard: { 
      enabled: isEnvEnabled('X_FRAME_OPTIONS_ENABLED', false), 
      action: process.env.X_FRAME_OPTIONS || "DENY" 
    },
    hidePoweredBy: isEnvEnabled('HIDE_POWERED_BY_ENABLED', false),
    referrerPolicy: {
      enabled: isEnvEnabled('REFERRER_POLICY_ENABLED', false),
      value: process.env.REFERRER_POLICY || "strict-origin-when-cross-origin",
    },
    permissionsPolicy: {
      enabled: isEnvEnabled('PERMISSIONS_POLICY_ENABLED', false),
      directives: parsePermissionsPolicy(process.env.PERMISSIONS_POLICY) || { camera: "()", microphone: "()", geolocation: "()" },
    },
  };

  const config = { ...defaults, ...options };

  // [V8-OPT] Pre-calculate static headers outside the request loop
  const staticHeaders = [];

  if (config.hsts.enabled) {
    let val = `max-age=${config.hsts.maxAge}${config.hsts.includeSubDomains ? "; includeSubDomains" : ""}${config.hsts.preload ? "; preload" : ""}`;
    staticHeaders.push(["Strict-Transport-Security", val]);
  }
  if (config.noSniff.enabled) staticHeaders.push(["X-Content-Type-Options", "nosniff"]);
  if (config.xssFilter.enabled) staticHeaders.push(["X-XSS-Protection", "1; mode=block"]);
  if (config.frameguard.enabled) staticHeaders.push(["X-Frame-Options", config.frameguard.action.toUpperCase()]);
  if (config.referrerPolicy.enabled) staticHeaders.push(["Referrer-Policy", config.referrerPolicy.value]);
  if (config.permissionsPolicy.enabled) {
    const p = Object.entries(config.permissionsPolicy.directives).map(([f, v]) => `${f}=${v}`).join(", ");
    staticHeaders.push(["Permissions-Policy", p]);
  }

  return async function securityMiddleware(context, next) {
    // 1. Batch write pre-calculated headers
    for (let i = 0; i < staticHeaders.length; i++) {
      context.setHeader(staticHeaders[i][0], staticHeaders[i][1]);
    }

    // 2. Remove sensitive headers
    if (config.hidePoweredBy && context._response && typeof context._response.removeHeader === 'function') {
      context._response.removeHeader("X-Powered-By");
    }

    // 3. Call next
    if (typeof next === "function") {
      return next();
    }
  };
}

export default createSecurityMiddleware;
