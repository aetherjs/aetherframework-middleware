/**
 * Simplified Advanced Server - Clean and Performant Edition
 */
import http from "http";
import { AetherPipeline } from "../index.js";

// 1. Create pipeline
const pipeline = new AetherPipeline();

// 2. Basic middleware: Logging
const logger = (ctx) => {
  console.log(`[${new Date().toISOString()}] ${ctx.method} ${ctx.url}`);
};
pipeline.use(logger);

// 3. Basic middleware: CORS headers
pipeline.use((ctx) => {
  ctx.setHeader("Access-Control-Allow-Origin", "*");
  ctx.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  ctx.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
});

// 4. Basic middleware: Security headers
pipeline.use((ctx) => {
  ctx.setHeader("X-Content-Type-Options", "nosniff");
  ctx.setHeader("X-Frame-Options", "DENY");
  ctx.setHeader("X-XSS-Protection", "1; mode=block");
});

// 5. Route handling
pipeline.use((ctx) => {
  if (ctx.url === "/health") {
    ctx.setStatus(200);
    ctx.setHeader("Content-Type", "application/json");
    ctx.body = JSON.stringify({ 
      status: "ok", 
      timestamp: Date.now(),
      server: "Simplified AetherJS"
    });
    ctx._isHandled = true;
    return true;
  }
});

pipeline.use((ctx) => {
  if (ctx.url === "/public/info") {
    ctx.setStatus(200);
    ctx.setHeader("Content-Type", "application/json");
    ctx.body = JSON.stringify({
      message: "This is public information",
      version: "1.0.0",
      endpoints: ["/health", "/public/info", "/api/data"]
    });
    ctx._isHandled = true;
    return true;
  }
});

pipeline.use((ctx) => {
  if (ctx.url === "/api/data" && ctx.method === "GET") {
    ctx.setStatus(200);
    ctx.setHeader("Content-Type", "application/json");
    ctx.body = JSON.stringify({
      data: [1, 2, 3, 4, 5],
      message: "Sample API data",
      timestamp: Date.now()
    });
    ctx._isHandled = true;
    return true;
  }
});

pipeline.use((ctx) => {
  if (ctx.url === "/api/data" && ctx.method === "POST") {
    // Simple POST request handling
    let body = "";
    ctx.req.on("data", chunk => {
      body += chunk.toString();
    });
    ctx.req.on("end", () => {
      ctx.setStatus(201);
      ctx.setHeader("Content-Type", "application/json");
      ctx.body = JSON.stringify({
        received: body ? JSON.parse(body) : null,
        message: "Data received successfully",
        id: Date.now()
      });
    });
    ctx._isHandled = true;
    return true;
  }
});

// 6. 404 handling
pipeline.use((ctx) => {
  if (ctx._isHandled || ctx.statusCode === 200 || ctx.res?.statusCode === 200) {
    return;
  }
  ctx.setStatus(404);
  ctx.setHeader("Content-Type", "application/json");
  ctx.body = JSON.stringify({ 
    error: "Not Found",
    path: ctx.url,
    method: ctx.method
  });
});


// 8. Create HTTP server
const server = http.createServer(async (req, res) => {
  try {
    await pipeline.handle(req, res);
  } catch (err) {
    console.error("Pipeline Error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
  }
});

// 9. Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Simplified Advanced Server running on http://localhost:${PORT}`);
  console.log(`📊 Available endpoints:`);
  console.log(`   GET  /health        - Health check`);
  console.log(`   GET  /public/info   - Public information`);
  console.log(`   GET  /api/data      - Get sample data`);
  console.log(`   POST /api/data      - Submit data`);
});
