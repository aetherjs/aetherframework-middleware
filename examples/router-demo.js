// examples/router-demo.js
import { AetherPipeline, middleware } from '../index.js';

// Create application instance
const app = new AetherPipeline();

// Use global middlewares
app.use(middleware.cors());
app.use(middleware.security());
app.use(middleware.bodyParser());
app.use(middleware.json());

// DEBUG: Check what middleware.router contains
console.log('Debug: middleware.router type:', typeof middleware.router);
console.log('Debug: middleware.router keys:', Object.keys(middleware.router || {}));

// IMPORTANT FIX: The issue is that middleware.router is the createRouterMiddleware function
// According to router.js, it exports both createRouterMiddleware and AetherRouter
// We need to access the Router class from the exported object

// Create router instance - CORRECT APPROACH
let router;

// Approach 1: Check if AetherRouter is available as a property
if (middleware.router && middleware.router.AetherRouter) {
    // Use the AetherRouter class from the exported object
    const AetherRouter = middleware.router.AetherRouter;
    router = new AetherRouter();
    console.log('Router created using middleware.router.AetherRouter constructor');
} 
// Approach 2: Check if createRouterMiddleware has Router property
else if (middleware.router && middleware.router.Router) {
    // Use the Router property attached to createRouterMiddleware
    router = new middleware.router.Router();
    console.log('Router created using middleware.router.Router()');
}
// Approach 3: Check if middleware.router itself is the AetherRouter class
else if (typeof middleware.router === 'function' && middleware.router.prototype && middleware.router.prototype.get) {
    // middleware.router is the AetherRouter class itself
    router = new middleware.router();
    console.log('Router created using middleware.router() as constructor');
}
// Approach 4: Last resort - check the actual exports
else {
    console.error('Cannot create router instance. Checking exports...');
    
    // Try to import AetherRouter directly if possible
    try {
        // Based on router.js exports, we should have access to AetherRouter
        // Let's check if it's available in the middleware.router object
        if (middleware.router && typeof middleware.router === 'object') {
            // The exports might be structured differently
            for (const key in middleware.router) {
                console.log(`Export key: ${key}, type: ${typeof middleware.router[key]}`);
                if (key === 'AetherRouter' || key === 'Router') {
                    const RouterClass = middleware.router[key];
                    if (typeof RouterClass === 'function') {
                        router = new RouterClass();
                        console.log(`Router created using middleware.router.${key}`);
                        break;
                    }
                }
            }
        }
        
        // If still no router, create a fallback
        if (!router) {
            console.error('Creating fallback router');
            router = {
                routes: new Map(),
                get: function(path, handler) {
                    this.routes.set(`GET:${path}`, handler);
                    return this;
                },
                post: function(path, handler) {
                    this.routes.set(`POST:${path}`, handler);
                    return this;
                },
                middleware: function() {
                    return async (ctx, next) => {
                        const routeKey = `${ctx.method}:${ctx.url}`;
                        const handler = this.routes.get(routeKey);
                        if (handler) {
                            await handler(ctx);
                        } else if (typeof next === 'function') {
                            await next();
                        }
                    };
                }
            };
        }
    } catch (error) {
        console.error('Error creating router:', error);
        throw error;
    }
}

// ========== BASIC ROUTES ==========
// Check if router.get exists before using it
if (typeof router.get === 'function') {
    router.get("/", (ctx) => {
        ctx.json({ message: "Welcome to AetherJS API" });
    });

    // Path parameters - Use getState for query parameters
    router.get("/users/:id", (ctx) => {
        // Use getState to access query parameters instead of direct ctx.query
        const query = ctx.getState("query") || {};
        ctx.json({ 
            userId: ctx.params.id,
            query: query // Supports &id=1&name=test&sort=asc
        });
    });

    // Query parameters - Use getState for query parameters
    router.get("/search", (ctx) => {
        const query = ctx.getState("query") || {};
        const { q, page = 1, limit = 10, sort = "desc" } = query;
        ctx.json({ 
            query: q,
            page: parseInt(page),
            limit: parseInt(limit),
            sort: sort
        });
    });

    // POST with body parsing
    router.post("/users", (ctx) => {
        const userData = ctx.getState("parsedBody");
        ctx.json({ 
            success: true, 
            data: userData,
            created: new Date().toISOString()
        });
    });
} else {
    console.error('router.get() method not available. Router may not be properly initialized.');
    throw new Error('Router not properly initialized');
}

// ========== ROUTE GROUPING ==========
// Check if router.group exists before using it
if (typeof router.group === 'function') {
    router.group("/api", (api) => {
        // /api/users
        api.get("/users", (ctx) => {
            ctx.json({ users: [] });
        });
        
        // /api/users/:id
        api.get("/users/:id", (ctx) => {
            ctx.json({ user: { id: ctx.params.id } });
        });
        
        // Nested grouping
        api.group("/v1", (v1) => {
            // /api/v1/products
            v1.get("/products", (ctx) => {
                ctx.json({ products: [] });
            });
            
            // /api/v1/products/:id
            v1.get("/products/:id", (ctx) => {
                ctx.json({ productId: ctx.params.id });
            });
        });
    });
} else {
    console.log('Router.group() method not available, using direct routes instead');
    // Fallback: Define routes directly without grouping
    router.get("/api/users", (ctx) => {
        ctx.json({ users: [] });
    });
    
    router.get("/api/users/:id", (ctx) => {
        ctx.json({ user: { id: ctx.params.id } });
    });
    
    router.get("/api/v1/products", (ctx) => {
        ctx.json({ products: [] });
    });
    
    router.get("/api/v1/products/:id", (ctx) => {
        ctx.json({ productId: ctx.params.id });
    });
}

// ========== API VERSIONING ==========
// Check if version method exists before using it
// If version() doesn't exist, use group() method as alternative
if (typeof router.version === 'function') {
    router.version("1", (v1) => {
        v1.get("/users", (ctx) => {
            ctx.json({ version: "v1", users: [] });
        });
        
        v1.post("/users", (ctx) => {
            ctx.json({ version: "v1", created: true });
        });
    });

    router.version("2", (v2) => {
        v2.get("/users", (ctx) => {
            ctx.json({ 
                version: "v2", 
                users: [], 
                features: ["enhanced", "pagination"] 
            });
        });
    });
} else {
    console.log('Router.version() method not available, using group() for versioning');
    // Alternative: Use group method for versioning
    // First check if group method is available
    if (typeof router.group === 'function') {
        router.group("/v1", (v1) => {
            v1.get("/users", (ctx) => {
                ctx.json({ version: "v1", users: [] });
            });
            
            v1.post("/users", (ctx) => {
                ctx.json({ version: "v1", created: true });
            });
        });

        router.group("/v2", (v2) => {
            v2.get("/users", (ctx) => {
                ctx.json({ 
                    version: "v2", 
                    users: [], 
                    features: ["enhanced", "pagination"] 
                });
            });
        });
    } else {
        // If group is also not available, define routes directly
        router.get("/v1/users", (ctx) => {
            ctx.json({ version: "v1", users: [] });
        });
        
        router.post("/v1/users", (ctx) => {
            ctx.json({ version: "v1", created: true });
        });
        
        router.get("/v2/users", (ctx) => {
            ctx.json({ 
                version: "v2", 
                users: [], 
                features: ["enhanced", "pagination"] 
            });
        });
    }
}

// ========== ROUTE MIDDLEWARE ==========
const authMiddleware = async (ctx, next) => {
    const token = ctx.getHeader("authorization");
    if (!token) {
        return ctx.setStatus(401).json({ error: "Unauthorized" });
    }
    await next();
};

const loggerMiddleware = async (ctx, next) => {
    console.log(`[${new Date().toISOString()}] ${ctx.method} ${ctx.url}`);
    await next();
};

// Apply middleware to specific routes
router.get("/admin/dashboard", authMiddleware, loggerMiddleware, (ctx) => {
    ctx.json({ admin: true, data: "Sensitive information" });
});

// ========== WILDCARD ROUTES ==========
router.get("/files/*", (ctx) => {
    const filePath = ctx.params["0"]; // Wildcard parameter
    ctx.json({ file: filePath });
});

// ========== OPTIONAL PARAMETERS ==========
router.get("/posts/:id?", (ctx) => {
    if (ctx.params.id) {
        ctx.json({ post: ctx.params.id });
    } else {
        ctx.json({ posts: [] });
    }
});

// ========== REGEX CONSTRAINTS ==========
router.get("/users/:id(\\d+)", (ctx) => {
    // Only matches numeric IDs
    ctx.json({ userId: parseInt(ctx.params.id) });
});

// ========== MULTIPLE PARAMETERS ==========
router.get("/products/:category/:id", (ctx) => {
    const query = ctx.getState("query") || {};
    ctx.json({ 
        category: ctx.params.category,
        productId: ctx.params.id,
        query: query
    });
});

// ========== ARRAY QUERY PARAMETERS ==========
// Supports: /api/filter?tags=js&tags=node&tags=express
router.get("/api/filter", (ctx) => {
    const query = ctx.getState("query") || {};
    const { tags = [], page = 1 } = query;
    ctx.json({ 
        tags: Array.isArray(tags) ? tags : [tags],
        page: parseInt(page)
    });
});

// Add router middleware to pipeline
if (typeof router.middleware === 'function') {
    app.use(router.middleware());
} else {
    console.error('Router.middleware() method not available');
    // Fallback: Add routes directly to pipeline
    app.use(async (ctx, next) => {
        const routeKey = `${ctx.method}:${ctx.url}`;
        const handler = router.routes?.get(routeKey);
        if (handler) {
            await handler(ctx);
        } else if (typeof next === 'function') {
            await next();
        }
    });
}

// ========== ERROR HANDLING ==========
app.use(async (ctx) => {
    if (!ctx.isTerminated()) {
        ctx.setStatus(404).json({
            error: "Not Found",
            message: `Cannot ${ctx.method} ${ctx.url}`,
            timestamp: new Date().toISOString()
        });
    }
});

// Start server
import http from "http";

const server = http.createServer(async (req, res) => {
    await app.handle(req, res);
});

server.listen(3000, () => {
    console.log("🚀 AetherJS Server running on http://localhost:3000");
    console.log("📋 Available routes:");
    
    // Check if getRoutes method exists
    if (typeof router.getRoutes === 'function') {
        console.log(router.getRoutes());
    } else if (router.routes) {
        // Fallback: Display routes from router.routes Map
        const routes = [];
        router.routes.forEach((handler, key) => {
            const [method, path] = key.split(':');
            routes.push({ method, path });
        });
        console.log(routes);
    } else {
        console.log('No route information available');
    }
});
