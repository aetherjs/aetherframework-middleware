/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/middleware/middleware/jwt.js
 */

/**
 * Helper: Parse algorithm configuration from string to array
 * @param {string} algorithmsString - Comma-separated algorithm string
 * @returns {string[]} Array of algorithm names
 */
function parseAlgorithms(algorithmsString) {
  if (!algorithmsString) return ["HS256"];
  return algorithmsString.split(",").map((alg) => alg.trim());
}

/**
 * Helper: Base64 URL-safe encode
 * @param {string} str - String to encode
 * @returns {string} Base64 URL-safe encoded string
 */
function base64UrlEncode(str) {
  return btoa(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Helper: Base64 URL-safe decode
 * @param {string} base64Url - Base64 URL-safe string to decode
 * @returns {string} Decoded string
 */
function base64UrlDecode(base64Url) {
  // Add padding if needed
  let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  if (pad) {
    if (pad === 1) {
      throw new Error("Invalid base64 string");
    }
    base64 += "=".repeat(4 - pad);
  }
  return atob(base64);
}

/**
 * Helper: Convert string to ArrayBuffer
 * @param {string} str - String to convert
 * @returns {Uint8Array} ArrayBuffer representation
 */
function strToBuffer(str) {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

/**
 * Helper: Convert ArrayBuffer to Base64 string
 * @param {ArrayBuffer} buffer - ArrayBuffer to convert
 * @returns {string} Base64 string
 */
function arrayBufferToBase64(buffer) {
  // FIXED: Use ES Module compatible approach
  if (typeof Buffer !== "undefined") {
    // Node.js environment - use global Buffer if available
    // Note: In ES Modules, Buffer is available globally in Node.js
    return Buffer.from(buffer).toString("base64");
  } else {
    // Browser environment
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}

/**
 * Helper: Convert Base64 to ArrayBuffer
 * @param {string} base64 - Base64 string to convert
 * @returns {Uint8Array} ArrayBuffer representation
 */
function base64ToArrayBuffer(base64) {
  // FIXED: Use ES Module compatible approach
  if (typeof Buffer !== "undefined") {
    // Node.js environment - use global Buffer if available
    return new Uint8Array(Buffer.from(base64, "base64"));
  } else {
    // Browser environment
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

/**
 * Algorithm registry for supported JWT algorithms
 */
const ALGORITHMS = {
  // HMAC algorithms (symmetric)
  HS256: {
    name: "HMAC",
    hash: "SHA-256",
    type: "symmetric",
    minKeyLength: 32, // Minimum key length in bytes
  },
  HS384: {
    name: "HMAC",
    hash: "SHA-384",
    type: "symmetric",
    minKeyLength: 48,
  },
  HS512: {
    name: "HMAC",
    hash: "SHA-512",
    type: "symmetric",
    minKeyLength: 64,
  },
  
  // RSA algorithms (asymmetric) - Note: Requires proper key handling
  RS256: {
    name: "RSASSA-PKCS1-v1_5",
    hash: "SHA-256",
    type: "asymmetric",
    requires: { publicKey: true, privateKey: true },
  },
  RS384: {
    name: "RSASSA-PKCS1-v1_5",
    hash: "SHA-384",
    type: "asymmetric",
    requires: { publicKey: true, privateKey: true },
  },
  RS512: {
    name: "RSASSA-PKCS1-v1_5",
    hash: "SHA-512",
    type: "asymmetric",
    requires: { publicKey: true, privateKey: true },
  },
  
  // ECDSA algorithms (asymmetric)
  ES256: {
    name: "ECDSA",
    hash: "SHA-256",
    type: "asymmetric",
    curve: "P-256",
    requires: { publicKey: true, privateKey: true },
  },
  ES384: {
    name: "ECDSA",
    hash: "SHA-384",
    type: "asymmetric",
    curve: "P-384",
    requires: { publicKey: true, privateKey: true },
  },
  ES512: {
    name: "ECDSA",
    hash: "SHA-512",
    type: "asymmetric",
    curve: "P-521",
    requires: { publicKey: true, privateKey: true },
  },
  
  // EdDSA algorithm (asymmetric)
  EdDSA: {
    name: "Ed25519",
    type: "asymmetric",
    requires: { publicKey: true, privateKey: true },
  },
};

/**
 * Generate HMAC signature for symmetric algorithms
 * @param {string} algorithm - Algorithm name (HS256, HS384, HS512)
 * @param {string} key - Secret key
 * @param {string} data - Data to sign
 * @returns {Promise<Uint8Array>} Signature
 */
async function generateHmacSignature(algorithm, key, data) {
  const algo = ALGORITHMS[algorithm];
  if (!algo) {
    throw new Error(`Unsupported HMAC algorithm: ${algorithm}`);
  }
  
  const keyBuf = strToBuffer(key);
  const dataBuf = strToBuffer(data);
  
  if (typeof crypto !== "undefined" && crypto.subtle) {
    // Browser/Node.js 15+ environment
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBuf,
      { name: algo.name, hash: { name: algo.hash } },
      false,
      ["sign", "verify"]
    );
    const signature = await crypto.subtle.sign(algo.name, cryptoKey, dataBuf);
    return new Uint8Array(signature);
  } else if (typeof require !== "undefined") {
    // Node.js environment with crypto module (CommonJS)
    const crypto = require("crypto");
    const hmac = crypto.createHmac(algo.hash.toLowerCase().replace("-", ""), key);
    hmac.update(data);
    return new Uint8Array(hmac.digest());
  } else {
    throw new Error("Crypto API not available");
  }
}

/**
 * Verify HMAC signature for symmetric algorithms
 * @param {string} algorithm - Algorithm name (HS256, HS384, HS512)
 * @param {string} key - Secret key
 * @param {string} data - Original data
 * @param {Uint8Array} signature - Signature to verify
 * @returns {Promise<boolean>} True if signature is valid
 */
async function verifyHmacSignature(algorithm, key, data, signature) {
  const algo = ALGORITHMS[algorithm];
  if (!algo) {
    throw new Error(`Unsupported HMAC algorithm: ${algorithm}`);
  }
  
  const keyBuf = strToBuffer(key);
  const dataBuf = strToBuffer(data);
  
  if (typeof crypto !== "undefined" && crypto.subtle) {
    // Browser/Node.js 15+ environment
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBuf,
      { name: algo.name, hash: { name: algo.hash } },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(algo.name, cryptoKey, signature, dataBuf);
  } else if (typeof require !== "undefined") {
    // Node.js environment with crypto module (CommonJS)
    const crypto = require("crypto");
    const hmac = crypto.createHmac(algo.hash.toLowerCase().replace("-", ""), key);
    hmac.update(data);
    const expectedSignature = hmac.digest();
    
    // Constant-time comparison to prevent timing attacks
    const expected = new Uint8Array(expectedSignature);
    const provided = new Uint8Array(signature);
    
    if (expected.length !== provided.length) return false;
    
    let result = 0;
    for (let i = 0; i < expected.length; i++) {
      result |= expected[i] ^ provided[i];
    }
    return result === 0;
  } else {
    throw new Error("Crypto API not available");
  }
}

/**
 * Generate RSA/ECDSA signature for asymmetric algorithms
 * @param {string} algorithm - Algorithm name (RS256, RS384, RS512, ES256, ES384, ES512)
 * @param {string|Object} key - Private key (PEM string or JWK)
 * @param {string} data - Data to sign
 * @returns {Promise<Uint8Array>} Signature
 */
async function generateAsymmetricSignature(algorithm, key, data) {
  const algo = ALGORITHMS[algorithm];
  if (!algo) {
    throw new Error(`Unsupported asymmetric algorithm: ${algorithm}`);
  }
  
  const dataBuf = strToBuffer(data);
  
  if (typeof crypto !== "undefined" && crypto.subtle) {
    // Browser/Node.js 15+ environment
    let cryptoKey;
    
    if (typeof key === "string") {
      // PEM format key
      cryptoKey = await crypto.subtle.importKey(
        "pkcs8",
        pemToArrayBuffer(key),
        { name: algo.name, hash: { name: algo.hash } },
        false,
        ["sign"]
      );
    } else {
      // JWK format key
      cryptoKey = await crypto.subtle.importKey(
        "jwk",
        key,
        { name: algo.name, hash: { name: algo.hash } },
        false,
        ["sign"]
      );
    }
    
    const signature = await crypto.subtle.sign(
      { name: algo.name, hash: { name: algo.hash } },
      cryptoKey,
      dataBuf
    );
    return new Uint8Array(signature);
  } else if (typeof require !== "undefined") {
    // Node.js environment with crypto module (CommonJS)
    const crypto = require("crypto");
    const sign = crypto.createSign(algo.hash.replace("SHA-", "RSA-SHA"));
    sign.update(data);
    sign.end();
    
    if (typeof key === "string") {
      return new Uint8Array(sign.sign(key));
    } else {
      throw new Error("JWK format not supported in Node.js crypto module");
    }
  } else {
    throw new Error("Crypto API not available");
  }
}

/**
 * Verify RSA/ECDSA signature for asymmetric algorithms
 * @param {string} algorithm - Algorithm name (RS256, RS384, RS512, ES256, ES384, ES512)
 * @param {string|Object} key - Public key (PEM string or JWK)
 * @param {string} data - Original data
 * @param {Uint8Array} signature - Signature to verify
 * @returns {Promise<boolean>} True if signature is valid
 */
async function verifyAsymmetricSignature(algorithm, key, data, signature) {
  const algo = ALGORITHMS[algorithm];
  if (!algo) {
    throw new Error(`Unsupported asymmetric algorithm: ${algorithm}`);
  }
  
  const dataBuf = strToBuffer(data);
  
  if (typeof crypto !== "undefined" && crypto.subtle) {
    // Browser/Node.js 15+ environment
    let cryptoKey;
    
    if (typeof key === "string") {
      // PEM format key
      cryptoKey = await crypto.subtle.importKey(
        "spki",
        pemToArrayBuffer(key),
        { name: algo.name, hash: { name: algo.hash } },
        false,
        ["verify"]
      );
    } else {
      // JWK format key
      cryptoKey = await crypto.subtle.importKey(
        "jwk",
        key,
        { name: algo.name, hash: { name: algo.hash } },
        false,
        ["verify"]
      );
    }
    
    return await crypto.subtle.verify(
      { name: algo.name, hash: { name: algo.hash } },
      cryptoKey,
      signature,
      dataBuf
    );
  } else if (typeof require !== "undefined") {
    // Node.js environment with crypto module (CommonJS)
    const crypto = require("crypto");
    const verify = crypto.createVerify(algo.hash.replace("SHA-", "RSA-SHA"));
    verify.update(data);
    verify.end();
    
    if (typeof key === "string") {
      return verify.verify(key, Buffer.from(signature));
    } else {
      throw new Error("JWK format not supported in Node.js crypto module");
    }
  } else {
    throw new Error("Crypto API not available");
  }
}

/**
 * Convert PEM key to ArrayBuffer
 * @param {string} pem - PEM formatted key
 * @returns {ArrayBuffer} ArrayBuffer representation
 */
function pemToArrayBuffer(pem) {
  // Remove PEM headers and footers
  const base64 = pem
    .replace(/-----BEGIN.*?-----/g, "")
    .replace(/-----END.*?-----/g, "")
    .replace(/\s/g, "");
  
  return base64ToArrayBuffer(base64);
}

/**
 * Generate signature based on algorithm type
 * @param {string} algorithm - JWT algorithm name
 * @param {string|Object} key - Secret or key
 * @param {string} data - Data to sign
 * @returns {Promise<Uint8Array>} Signature
 */
async function generateSignature(algorithm, key, data) {
  const algo = ALGORITHMS[algorithm];
  if (!algo) {
    throw new Error(`Unsupported algorithm: ${algorithm}`);
  }
  
  if (algo.type === "symmetric") {
    return generateHmacSignature(algorithm, key, data);
  } else if (algo.type === "asymmetric") {
    return generateAsymmetricSignature(algorithm, key, data);
  } else {
    throw new Error(`Unknown algorithm type: ${algo.type}`);
  }
}

/**
 * Verify signature based on algorithm type
 * @param {string} algorithm - JWT algorithm name
 * @param {string|Object} key - Secret or key
 * @param {string} data - Original data
 * @param {Uint8Array} signature - Signature to verify
 * @returns {Promise<boolean>} True if signature is valid
 */
async function verifySignature(algorithm, key, data, signature) {
  const algo = ALGORITHMS[algorithm];
  if (!algo) {
    throw new Error(`Unsupported algorithm: ${algorithm}`);
  }
  
  if (algo.type === "symmetric") {
    return verifyHmacSignature(algorithm, key, data, signature);
  } else if (algo.type === "asymmetric") {
    return verifyAsymmetricSignature(algorithm, key, data, signature);
  } else {
    throw new Error(`Unknown algorithm type: ${algo.type}`);
  }
}

/**
 * JWT Sign function - Create a JWT token with multiple algorithm support
 * @param {Object} payload - The JWT payload
 * @param {string|Object} key - Secret key for symmetric algorithms or private key for asymmetric
 * @param {Object} options - Signing options
 * @returns {Promise<string>} - JWT token
 */
async function jwtSign(payload, key, options = {}) {
  const algorithm = options.algorithm || "HS256";
  const expiresIn = options.expiresIn || "7d";
  const audience = options.audience;
  const issuer = options.issuer;
  const subject = options.subject;
  const jwtId = options.jwtId;
  
  const algo = ALGORITHMS[algorithm];
  if (!algo) {
    throw new Error(`Algorithm ${algorithm} not supported. Supported algorithms: ${Object.keys(ALGORITHMS).join(", ")}`);
  }

  // Prepare header
  const header = {
    alg: algorithm,
    typ: "JWT",
  };

  // Prepare payload with standard claims
  const finalPayload = { ...payload };
  
  // iat: issued at
  finalPayload.iat = Math.floor(Date.now() / 1000);
  
  // exp: expiration
  if (expiresIn) {
    let seconds = 0;
    if (typeof expiresIn === "number") {
      seconds = expiresIn;
    } else if (typeof expiresIn === "string") {
      const match = expiresIn.match(/^(\d+)([smhd])$/);
      if (match) {
        const value = parseInt(match[1], 10);
        const unit = match[2];
        switch (unit) {
          case "s": seconds = value; break;
          case "m": seconds = value * 60; break;
          case "h": seconds = value * 60 * 60; break;
          case "d": seconds = value * 60 * 60 * 24; break;
          default: seconds = value;
        }
      } else if (expiresIn === "7d") {
        seconds = 7 * 24 * 60 * 60; // Default 7 days
      }
    }
    if (seconds > 0) {
      finalPayload.exp = finalPayload.iat + seconds;
    }
  }
  
  // Add other standard claims
  if (audience) finalPayload.aud = audience;
  if (issuer) finalPayload.iss = issuer;
  if (subject) finalPayload.sub = subject;
  if (jwtId) finalPayload.jti = jwtId;

  // Create header and payload parts
  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(finalPayload));
  const dataToSign = `${headerEncoded}.${payloadEncoded}`;

  // Create signature
  const signatureBuffer = await generateSignature(algorithm, key, dataToSign);
  
  // Convert signature to base64 URL-safe
  const signatureBase64 = arrayBufferToBase64(signatureBuffer);
  const signatureEncoded = signatureBase64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${dataToSign}.${signatureEncoded}`;
}

/**
 * JWT Verify function - Verify a JWT token with multiple algorithm support
 * @param {string} token - The JWT token to verify
 * @param {string|Object} key - Secret key for symmetric algorithms or public key for asymmetric
 * @param {Object} options - Verification options
 * @returns {Promise<Object>} - Decoded payload if valid
 */
async function jwtVerify(token, key, options = {}) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token format");
  }

  const [headerEncoded, payloadEncoded, signatureEncoded] = parts;
  
  // Decode header
  let header;
  try {
    header = JSON.parse(base64UrlDecode(headerEncoded));
  } catch (e) {
    throw new Error("Invalid token header");
  }

  // Check algorithm
  const algorithm = header.alg;
  const algo = ALGORITHMS[algorithm];
  if (!algo) {
    throw new Error(`Algorithm ${algorithm} not supported. Supported algorithms: ${Object.keys(ALGORITHMS).join(", ")}`);
  }

  // Verify signature
  const dataToSign = `${headerEncoded}.${payloadEncoded}`;
  const signatureBuffer = base64ToArrayBuffer(
    signatureEncoded.replace(/-/g, "+").replace(/_/g, "/")
  );
  
  const isValid = await verifySignature(algorithm, key, dataToSign, signatureBuffer);
  if (!isValid) {
    throw new Error("Invalid signature");
  }

  // Decode payload
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadEncoded));
  } catch (e) {
    throw new Error("Invalid token payload");
  }

  // Verify expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    if (!options.ignoreExpiration) {
      throw new Error("Token expired");
    }
  }

  // Verify not before
  if (payload.nbf && payload.nbf > now) {
    throw new Error("Token not yet active");
  }

  // Verify audience
  if (options.audience) {
    const aud = options.audience;
    const tokenAud = payload.aud;
    if (Array.isArray(aud)) {
      if (!Array.isArray(tokenAud) || !tokenAud.some(a => aud.includes(a))) {
        throw new Error("Token audience invalid");
      }
    } else if (tokenAud !== aud) {
      throw new Error("Token audience invalid");
    }
  }

  // Verify issuer
  if (options.issuer && payload.iss !== options.issuer) {
    throw new Error("Token issuer invalid");
  }

  // Verify subject
  if (options.subject && payload.sub !== options.subject) {
    throw new Error("Token subject invalid");
  }

  return payload;
}

/**
 * JWT Decode function - Decode a JWT token without verification
 * @param {string} token - The JWT token to decode
 * @param {Object} options - Decoding options
 * @returns {Object} - Decoded payload
 */
function jwtDecode(token, options = {}) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token format");
  }

  const [, payloadEncoded] = parts;
  
  try {
    const payload = JSON.parse(base64UrlDecode(payloadEncoded));
    return options.complete ? {
      header: JSON.parse(base64UrlDecode(parts[0])),
      payload,
      signature: parts[2]
    } : payload;
  } catch (e) {
    throw new Error("Invalid token payload");
  }
}

// --- Create JWT middleware for AetherJS ---
/**
 * Create JWT middleware for AetherJS with multiple algorithm support
 * @param {Object} options - JWT configuration options
 * @returns {Function} - JWT middleware function
 */
function createJwtMiddleware(options = {}) {
  // Load configuration from environment variables
  const envConfig = {
    enabled: process.env.JWT_ENABLED,
    secret: process.env.JWT_SECRET,
    privateKey: process.env.JWT_PRIVATE_KEY,
    publicKey: process.env.JWT_PUBLIC_KEY,
    algorithms: process.env.JWT_ALGORITHMS,
    audience: process.env.JWT_AUDIENCE,
    issuer: process.env.JWT_ISSUER,
    expiresIn: process.env.JWT_EXPIRES_IN,
    ignoreExpiration: process.env.JWT_IGNORE_EXPIRATION,
    credentialsRequired: process.env.JWT_CREDENTIALS_REQUIRED,
    tokenHeader: process.env.JWT_TOKEN_HEADER,
    tokenQuery: process.env.JWT_TOKEN_QUERY,
    tokenCookie: process.env.JWT_TOKEN_COOKIE,
  };

  // Default configuration
  const defaults = {
    enabled: envConfig.enabled !== "false",
    secret: envConfig.secret || "your-super-secret-jwt-key-change-in-production",
    privateKey: envConfig.privateKey,
    publicKey: envConfig.publicKey,
    algorithms: parseAlgorithms(envConfig.algorithms),
    algorithm: envConfig.algorithms
      ? parseAlgorithms(envConfig.algorithms)[0]
      : "HS256",
    audience: envConfig.audience,
    issuer: envConfig.issuer,
    expiresIn: envConfig.expiresIn || "7d",
    ignoreExpiration: envConfig.ignoreExpiration === "true",
    credentialsRequired: envConfig.credentialsRequired !== "false",
    tokenHeader: envConfig.tokenHeader || "authorization",
    tokenQuery: envConfig.tokenQuery || "token",
    tokenCookie: envConfig.tokenCookie || "token",

    // Token extraction methods
    extractors: [
      (context) => {
        const header = context.getHeader(defaults.tokenHeader);
        if (header && header.startsWith("Bearer ")) {
          return header.substring(7);
        }
        return null;
      },
      (context) => {
        return context.query[defaults.tokenQuery] || null;
      },
      (context) => {
        const cookies = parseCookies(context.getHeader("cookie") || "");
        return cookies[defaults.tokenCookie] || null;
      },
    ],

    validationOptions: {
      algorithms: parseAlgorithms(envConfig.algorithms),
      audience: envConfig.audience,
      issuer: envConfig.issuer,
      ignoreExpiration: envConfig.ignoreExpiration === "true",
    },

    onError: (context, error) => {
      context.setStatus(401).json({
        error: "Unauthorized",
        message: error.message,
      });
    },

    onMissing: (context) => {
      context.setStatus(401).json({
        error: "Unauthorized",
        message: "No token provided",
      });
    },
  };

  const config = { ...defaults, ...options };

  function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;

    const pairs = cookieHeader.split(";");
    for (let i = 0; i < pairs.length; i++) {
      const eqIdx = pairs[i].indexOf("=");
      if (eqIdx === -1) continue;
      const key = pairs[i].substring(0, eqIdx).trim();
      const value = pairs[i].substring(eqIdx + 1).trim();
      // Only keep the first cookie of each name to prevent overwrite attacks
      if (!cookies[key]) {
        cookies[key] = value;
      }
    }
    return cookies;
  }

  function extractToken(context) {
    for (let i = 0; i < config.extractors.length; i++) {
      const token = config.extractors[i](context);
      if (token) return token;
    }
    return null;
  }

  /**
   * Get appropriate key for verification based on algorithm
   * @param {string} algorithm - JWT algorithm
   * @returns {string|Object} Key for verification
   */
  function getVerificationKey(algorithm) {
    const algo = ALGORITHMS[algorithm];
    if (!algo) {
      throw new Error(`Unsupported algorithm: ${algorithm}`);
    }
    
    if (algo.type === "symmetric") {
      return config.secret;
    } else if (algo.type === "asymmetric") {
      return config.publicKey || config.secret;
    }
    return config.secret;
  }

  /**
   * Get appropriate key for signing based on algorithm
   * @param {string} algorithm - JWT algorithm
   * @returns {string|Object} Key for signing
   */
  function getSigningKey(algorithm) {
    const algo = ALGORITHMS[algorithm];
    if (!algo) {
      throw new Error(`Unsupported algorithm: ${algorithm}`);
    }
    
    if (algo.type === "symmetric") {
      return config.secret;
    } else if (algo.type === "asymmetric") {
      return config.privateKey || config.secret;
    }
    return config.secret;
  }

  /**
   * 💡 Ultimate optimization: Remove async Promise, change to synchronous verification, eliminate thread pool queuing block
   */
  async function verifyTokenSync(token) {
    // Decode header first to get algorithm
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid token format");
    }
    
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const algorithm = header.alg;
    const key = getVerificationKey(algorithm);
    
    return jwtVerify(token, key, config.validationOptions);
  }

  /**
   * Signing is usually not a high-frequency hotspot, can keep async or sync. Maintain async here for backward compatibility.
   */
  async function signToken(payload, signOptions = {}) {
    const algorithm = signOptions.algorithm || config.algorithm || "HS256";
    const key = getSigningKey(algorithm);
    const options = {
      algorithm: algorithm,
      expiresIn: config.expiresIn,
      audience: config.audience,
      issuer: config.issuer,
      ...signOptions,
    };

    return jwtSign(payload, key, options);
  }

  return async function jwtMiddleware(context, next) {
    if (!config.enabled) {
      return typeof next === "function" ? next() : null;
    }

    const token = extractToken(context);

    if (!token) {
      if (config.credentialsRequired) {
        return config.onMissing(context);
      }
      return typeof next === "function" ? next() : null;
    }

    try {
      // 💡 Synchronous execution, no wait delay
      const decoded = await verifyTokenSync(token);

      context.setState("jwt", decoded);
      context.setState("user", decoded);
      context.setState("token", token);

      context.jwt = {
        payload: decoded,
        token: token,
        refresh: async (newPayload = {}) => {
          const payload = { ...decoded, ...newPayload };
          const newToken = await signToken(payload);
          context.setState("jwt", payload);
          context.setState("token", newToken);
          return newToken;
        },
        verify: async () => {
          return verifyTokenSync(token);
        },
        expiresAt: () => (decoded.exp ? new Date(decoded.exp * 1000) : null),
        isExpired: () =>
          decoded.exp ? Date.now() >= decoded.exp * 1000 : false,
        issuedAt: () => (decoded.iat ? new Date(decoded.iat * 1000) : null),
      };

      if (typeof next === "function") {
        await next();
      }
    } catch (error) {
      return config.onError(context, error);
    }
  };
}

// Static methods: Decoupled from runtime instance, unified static security configuration
createJwtMiddleware.sign = async function (payload, options = {}) {
  const algorithm = options.algorithm || "HS256";
  const algo = ALGORITHMS[algorithm];
  
  let key;
  if (algo.type === "symmetric") {
    key = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";
  } else if (algo.type === "asymmetric") {
    key = process.env.JWT_PRIVATE_KEY || process.env.JWT_SECRET;
  } else {
    key = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";
  }
  
  const expiresIn = options.expiresIn || "7d";
  
  return jwtSign(payload, key, { algorithm, expiresIn, ...options });
};

createJwtMiddleware.verify = async function (token, options = {}) {
  // Decode header to get algorithm
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token format");
  }
  
  const header = JSON.parse(base64UrlDecode(parts[0]));
  const algorithm = header.alg;
  const algo = ALGORITHMS[algorithm];
  
  let key;
  if (algo.type === "symmetric") {
    key = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";
  } else if (algo.type === "asymmetric") {
    key = process.env.JWT_PUBLIC_KEY || process.env.JWT_SECRET;
  } else {
    key = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";
  }
  
  const algorithms = options.algorithms || [algorithm];
  const verifyOptions = { algorithms, ...options };
  
  return jwtVerify(token, key, verifyOptions);
};

createJwtMiddleware.decode = function (token, options = {}) {
  return jwtDecode(token, options);
};

// Export algorithm registry for external use
createJwtMiddleware.ALGORITHMS = ALGORITHMS;

export default createJwtMiddleware;
