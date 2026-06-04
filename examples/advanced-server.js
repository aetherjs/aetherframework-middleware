/**
 * @license MIT
 * Copyright (c) 2026-present, AetherFramework Contributors.
 * Advanced Server Example - AetherFramework
 * 
 * Features:
 * - Zero-allocation middleware execution
 * - Optimized routing with ctx.path
 * - Proper request body parsing (ctx.req.body)
 * - Flawless Graceful Shutdown (Handles Keep-Alive sockets)
 */

import http from "http";
import { AetherPipeline } from "../index.js";

// Import optimized middleware (Ensure these paths match your project structure)
import security from "../src/middleware/security.js";
import rateLimit from "../src/middleware/rate-limit.js";
import cors from "../src/middleware/cors.js";
import jwt from "../src/middleware/jwt.js";
import bodyParser from "../src/middleware/body-parser.js";
import compression from "../src/middleware/compression.js";
import SessionManager from "../src/middleware/session.js";

// ==========================================================
// 1. Load Configuration
// ==========================================================
const config = {
  jwtSecret: process.env.JWT_SECRET || "dev-secret",
  port: process.env.PORT || 3001,
  sessionSecret: process.env.SESSION_SECRET || "aether-session-secret",
};

// Initialize Aether pipeline
const pipeline = new AetherPipeline();

// ==========================================================
// 2. Pre-initialize Middleware (Zero-allocation in request loop)
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
  enabled: process.env.COMPRESSION_ENABLED !== "false", 
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

// Body parser will attach parsed data to ctx.req.body
const bodyParserMiddleware = bodyParser({
  json: { enabled: true, limit: "1mb" },
});

const jwtMiddlewareInstance = jwt({
  secret: config.jwtSecret,
  algorithms: ["HS256"],
});

// ==========================================================
// 3. Mount Middleware Pipeline
// ==========================================================

// Global Middlewares
pipeline.use(securityMiddleware);
pipeline.use(corsMiddleware);
pipeline.use(compressionMiddleware);
pipeline.use(sessionMiddleware);
pipeline.use(rateLimitMiddleware);
pipeline.use(bodyParserMiddleware); // Attaches parsed JSON to ctx.req.body

// --- Public Routes ---
pipeline.use((ctx, next) => {
  if (ctx.isTerminated()) return;
  
  if (ctx.path === "/public/info") { 
    ctx.setStatus(200);
    ctx.json({ message: "This is public information", timestamp: Date.now() });
    return; 
  }
  return next(); 
});

// --- Session Routes ---
pipeline.use((ctx, next) => {
  if (ctx.isTerminated()) return;

  if (ctx.path === "/session/example") {
    const visitCount = ctx.session?.get("visitCount") || 0;
    ctx.session?.set("visitCount", visitCount + 1);
    ctx.session?.set("lastVisit", new Date().toISOString());

    ctx.setStatus(200);
    ctx.json({
      message: "Session example",
      sessionId: ctx.session?.id || "unknown",
      visitCount: visitCount + 1,
    });
    return; 
  }
  return next(); 
});

// --- Auth Routes (Login/Logout) ---
pipeline.use((ctx, next) => {
  if (ctx.isTerminated()) return;

  if (ctx.path === "/api/login" && ctx.method === "POST") {
    // Read request body from ctx.req.body (populated by bodyParser)
    const { username, password } = ctx.req.body || {};

    if (username === "admin" && password === "password") {
      ctx.session?.set("user", { id: 1, username, role: "admin", loggedIn: true });
      ctx.session?.save();
      ctx.setStatus(200);
      ctx.json({ message: "Login successful" });
    } else {
      ctx.setStatus(401);
      ctx.json({ error: "Invalid credentials" });
    }
    return; 
  }

  if (ctx.path === "/api/logout" && ctx.method === "POST") {
    ctx.session?.destroy();
    ctx.setStatus(200);
    ctx.json({ message: "Logged out successfully" });
    return; 
  }
  
  return next(); 
});

// --- JWT Protection Middleware ---
pipeline.use(async (ctx, next) => {
  if (ctx.isTerminated()) return;
  
  // Apply JWT to /api/ routes, EXCLUDING login/logout
  if (ctx.path.startsWith("/api/") && 
      ctx.path !== "/api/login" && 
      ctx.path !== "/api/logout") {
    await jwtMiddlewareInstance(ctx, next);
  } else {
    return next(); 
  }
});

// --- Protected API Routes ---
pipeline.use((ctx, next) => {
  if (ctx.isTerminated()) return;
  
  if (ctx.path === "/api/profile" && ctx.method === "GET") {
    ctx.setStatus(200);
    ctx.json({
      user: { id: 1, name: "Mock User" },
      message: "Access granted",
    });
    return; 
  }
  return next(); 
});

pipeline.use((ctx, next) => {
  if (ctx.isTerminated()) return;

  if (ctx.path === "/api/data" && ctx.method === "POST") {
    const reqBody = ctx.req.body; 
    ctx.setStatus(200);
    ctx.json({
      received: reqBody,
      message: "Data created successfully",
    });
    return; 
  }
  return next(); 
});

// --- Fallback 404 (Must be last) ---
pipeline.use((ctx) => {
  if (ctx.isTerminated()) return;
  
  ctx.setStatus(404);
  ctx.json({ 
    error: "Route not found",
    path: ctx.path,
    method: ctx.method
  });
});

// ==========================================================
// 4. Create HTTP Server
// ==========================================================
const server = http.createServer(async (req, res) => {
  try {
    await pipeline.handle(req, res);
  } catch (err) {
    console.error("❌ Pipeline Error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end(JSON.stringify({ error: "Internal Server Error", message: err.message }));
    }
  }
});

// ==========================================================
// 5. Start Server
// ==========================================================
server.listen(config.port, () => {
  console.log(`🔒 Advanced Aether Server running on http://localhost:${config.port}`);
  console.log(`📊 Endpoints: /public/info, /session/example, /api/login, /api/logout, /api/profile, /api/data`);
});

// ==========================================================
// 6. Flawless Graceful Shutdown (Fixes hanging on exit)
// ==========================================================
let isShuttingDown = false;
const activeSockets = new Set();

// Track all active connections to destroy them on shutdown
server.on('connection', (socket) => {
  activeSockets.add(socket);
  socket.on('close', () => {
    activeSockets.delete(socket);
  });
});

function gracefulShutdown(signal) {
  // Prevent multiple executions (Fixes multiple console logs on spamming Ctrl+C)
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);

  // Stop accepting new connections
  server.close(() => {
    console.log('✅ HTTP server closed successfully.');
    process.exit(0);
  });

  // Forcefully destroy all active Keep-Alive connections
  // This is the critical step to prevent server.close() from hanging!
  for (const socket of activeSockets) {
    socket.destroy();
  }

  // Fallback: Force exit if it takes too long (e.g. 5 seconds)
  setTimeout(() => {
    console.error('❌ Could not close connections in time, forcefully shutting down.');
    process.exit(1);
  }, 5000); 
}

// Bind OS signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));   // Triggered by Ctrl+C
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // Triggered by kill commands / Docker / PM2
