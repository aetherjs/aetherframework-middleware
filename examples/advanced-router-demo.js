// examples/advanced-router-demo.js
import { AetherPipeline, middleware } from '../index.js';
import http from "http"; 

const app = new AetherPipeline();
const router = new middleware.router.Router();

// Use global middlewares
app.use(middleware.cors());
app.use(middleware.security());
app.use(middleware.bodyParser());
app.use(middleware.json());
app.use(middleware.params()); // Add parameter parsing middleware

// ========== ROUTE WITH VALIDATION ==========
const userValidation = {
  name: { 
    type: "string", 
    required: true, 
    minLength: 2, 
    maxLength: 50 
  },
  email: { 
    type: "string", 
    required: true, 
    pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" 
  },
  age: { 
    type: "number", 
    min: 18, 
    max: 100 
  },
  tags: { 
    type: "array" 
  }
};

router.post("/api/users", (ctx) => {
  // Parameters are already validated and parsed
  const { name, email, age, tags } = ctx.allParams;
  
  ctx.json({ 
    success: true,
    data: { 
      name, 
      email, 
      age, 
      tags,
      id: Date.now()
    }
  });
});

// Add validation rules to route
router.routes.get("POST:/api/users").validationRules = userValidation;

// ========== COMPLEX ROUTE EXAMPLE ==========
router.group("/api/v1", (v1) => {
  v1.use(middleware.jwt()); // JWT auth for all v1 routes
  
  v1.group("/admin", (admin) => {
    admin.get("/dashboard", (ctx) => {
      const user = ctx.getState("user");
      ctx.json({ 
        admin: true, 
        user,
        timestamp: new Date().toISOString()
      });
    });
    
    admin.get("/users", (ctx) => {
      const { page = 1, limit = 20, sort = "desc" } = ctx.query;
      ctx.json({ 
        page: parseInt(page),
        limit: parseInt(limit),
        sort,
        users: []
      });
    });
  });
  
  // 修复：将 'public' 改为非保留字名称
  v1.group("/public", (publicGroup) => {
    publicGroup.get("/products", (ctx) => {
      const { category, minPrice, maxPrice } = ctx.query;
      ctx.json({ 
        category,
        minPrice: minPrice ? parseFloat(minPrice) : null,
        maxPrice: maxPrice ? parseFloat(maxPrice) : null,
        products: []
      });
    });
  });
});

// Add router to pipeline
app.use(router.middleware());

// ========== 404 HANDLER ==========
app.use(async (ctx) => {
  if (!ctx.isTerminated()) {
    ctx.setStatus(404).json({
      error: "Not Found",
      message: `Cannot ${ctx.method} ${ctx.url}`,
      timestamp: new Date().toISOString()
    });
  }
});

// Start server using http.createServer
const server = http.createServer(async (req, res) => {
  await app.handle(req, res);
});

server.listen(3000, () => {
  console.log("🚀 Advanced AetherJS Server running on http://localhost:3000");
  console.log("📋 Registered routes:");
  console.log(router.getRoutes());
});
