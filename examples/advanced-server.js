/**
 * @license MIT
 * Copyright (c) 2026-present, AetherFramework Contributors.
 * Response compression middleware for AetherFramework framework.
 * Supports gzip, deflate, and brotli compression with zero-copy operations.
 */

import http from "http";
import { AetherPipeline } from "../index.js";

// Import optimized middleware
import security from "../src/middleware/security.js";
import rateLimit from "../src/middleware/rate-limit.js";
import cors from "../src/middleware/cors.js";
import jwt from "../src/middleware/jwt.js";
import bodyParser from "../src/middleware/body-parser.js";
import compression from "../src/middleware/compression.js";
import SessionManager from "../src/middleware/session.js";

// Load configuration
const config = {
  jwtSecret: process.env.JWT_SECRET || "dev-secret",
  port: process.env.PORT || 3001,
  sessionSecret: process.env.SESSION_SECRET || "aether-session-secret",
};

// Initialize Aether pipeline
const pipeline = new AetherPipeline();

// ==========================================================
// Middleware adapter: Convert standard (ctx, next) middleware to AetherPipeline (ctx, signal) format
// ==========================================================
function adaptMiddleware(standardMiddleware) {
  return async function adaptedMiddleware(ctx, signal) {
    // Define a standard next function that calls signal.next()
    const next = async () => {
      if (signal && typeof signal.next === "function") {
        return await signal.next();
      }
    };

    // Call the original middleware with ctx and the new next function
    // Note: Some middleware may not return a Promise, so use await to ensure execution completes
    try {
      const result = standardMiddleware(ctx, next);
      if (result && typeof result.then === "function") {
        await result;
      }
    } catch (error) {
      console.error("Middleware error:", error);
      // Optionally handle errors here or let the global error handler catch them
    }
  };
}

// ==========================================================
// Pre-initialize all middleware (never create in request callbacks)
// ==========================================================
const securityMiddleware = security({
  hsts: { enabled: true, maxAge: 31536000 },
  noSniff: { enabled: true },
  frameguard: { enabled: true, action: "DENY" },
});

const corsMiddleware = cors({
  origin: "*",
  credentials: true,
});

const compressionMiddleware = compression({
  enabled: process.env.COMPRESSION_ENABLED === "true",
  threshold: parseInt(process.env.COMPRESSION_THRESHOLD) || 1024,
  gzip: process.env.COMPRESSION_GZIP !== "false",
  deflate: process.env.COMPRESSION_DEFLATE === "true",
  brotli: process.env.COMPRESSION_BROTLI === "true",
  types: "application/json,text/plain",
});

const sessionManager = new SessionManager({
  enabled: true,
  secret: config.sessionSecret,
  maxAge: parseInt(process.env.SESSION_MAX_AGE) || 86400000,
  cookieName: "aether_session",
  store: "memory",
});
const sessionMiddleware = sessionManager.middleware();

const rateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  enabled: true,
});

const bodyParserMiddleware = bodyParser({
  json: { enabled: true, limit: "1mb" },
});

const jwtMiddlewareInstance = jwt({
  secret: config.jwtSecret,
  algorithms: ["HS256"],
});

// ==========================================================
// Mount middleware pipeline (explicitly pass control to next)
// ==========================================================

// 1. Security Headers
pipeline.use(securityMiddleware);

// 2. CORS
pipeline.use(corsMiddleware);

// 3. Response Compression
pipeline.use(compressionMiddleware);

// 4. Session Management
pipeline.use(sessionMiddleware);

// 5. Rate Limiting
pipeline.use(rateLimitMiddleware);

// 6. Body Parsing
pipeline.use(bodyParserMiddleware);

// 7. Public Routes
pipeline.use((ctx, next) => {
  if (ctx.isTerminated() || ctx.res?.writableEnded) return;
  if (ctx.url === "/public/info") {
    ctx.setStatus(200);
    ctx.json({ message: "This is public information" });
    if (typeof ctx.terminate === "function") ctx.terminate();
    return; // Endpoint reached, do not call next()
  }
  return next(); // Route not matched, must pass control
});

// 8. Session Example Route
pipeline.use((ctx, next) => {
  if (ctx.isTerminated() || ctx.res?.writableEnded) return;

  if (ctx.url === "/session/example") {
    const visitCount = ctx.session?.get("visitCount") || 0;
    ctx.session?.set("visitCount", visitCount + 1);
    ctx.session?.set("lastVisit", new Date().toISOString());

    ctx.setStatus(200);
    ctx.json({
      message: "Session example",
      sessionId: ctx.state?.session?.id,
      visitCount: visitCount + 1,
    });
    if (typeof ctx.terminate === "function") ctx.terminate();
    return;
  }
  return next(); // Pass control
});

// 9. Login Route
pipeline.use((ctx, next) => {
  if (ctx.isTerminated() || ctx.res?.writableEnded) return;

  if (ctx.url === "/api/login" && ctx.method === "POST") {
    const { username, password } = ctx._request?.body || ctx.body || {};

    if (username === "admin" && password === "password") {
      ctx.session?.set("user", {
        id: 1,
        username,
        role: "admin",
        loggedIn: true,
      });
      ctx.session?.save();

      ctx.setStatus(200);
      ctx.json({ message: "Login successful" });
    } else {
      ctx.setStatus(401);
      ctx.json({ error: "Invalid credentials" });
    }
    if (typeof ctx.terminate === "function") ctx.terminate();
    return;
  }
  return next(); // Pass control
});

// 10. Logout Route
pipeline.use((ctx, next) => {
  if (ctx.isTerminated() || ctx.res?.writableEnded) return;

  if (ctx.url === "/api/logout" && ctx.method === "POST") {
    ctx.session?.destroy();
    ctx.setStatus(200);
    ctx.json({ message: "Logged out successfully" });
    if (typeof ctx.terminate === "function") ctx.terminate();
    return;
  }
  return next(); // Pass control
});

// 11. JWT Protection for /api/* routes
pipeline.use(async (ctx, next) => {
  if (ctx.isTerminated() || ctx.res?.writableEnded) return;
  if (ctx.url.startsWith("/api/")) {
    // Standard parameter passing: pass Aether's next-level async dispatch pointer
    await jwtMiddlewareInstance(ctx, next);
  } else {
    return next(); // Skip non-/api/ routes directly
  }
});

// 12. Profile Route
pipeline.use((ctx, next) => {
  if (ctx.isTerminated() || ctx.res?.writableEnded) return;
  if (ctx.url === "/api/profile" && ctx.method === "GET") {
    ctx.setStatus(200);
    ctx.json({
      user: { id: 1, name: "Mock User" },
      message: "Access granted",
    });
    if (typeof ctx.terminate === "function") ctx.terminate();
    return;
  }
  return next(); // Pass control
});

// 13. POST Example
pipeline.use((ctx, next) => {
  if (ctx.isTerminated() || ctx.res?.writableEnded) return;

  if (ctx.url === "/api/data" && ctx.method === "POST") {
    const reqBody = ctx._request?.body || ctx.body;
    ctx.setStatus(200);
    ctx.json({
      received: reqBody,
      message: "Data created successfully",
    });
    if (typeof ctx.terminate === "function") ctx.terminate();
    return;
  }
  return next(); // Pass control
});

// 14. Fallback 404
pipeline.use((ctx) => {
  if (ctx.isTerminated() || ctx.res?.writableEnded) return;
  ctx.setStatus(404);
  ctx.json({ error: "Route not found" });
  if (typeof ctx.terminate === "function") ctx.terminate();
});

// 15. Precompile for optimization
pipeline.precompile();

// 16. Create HTTP server
const server = http.createServer(async (req, res) => {
  try {
    await pipeline.handle(req, res);
  } catch (err) {
    console.error("Pipeline Error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
  }
});

// Start server
server.listen(config.port, () => {
  console.log(`🔒 Advanced Server running on http://localhost:${config.port}`);
});
