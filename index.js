// index.js - ES Module version (updated)
// --- Core Components ---
import AetherContext from './src/core/AetherContext.js';
import AetherPipeline from './src/core/AetherPipeline.js';
import AetherStore from './src/core/AetherStore.js';
import AetherCompiler from './src/core/AetherCompiler.js';
import AetherRouter from './src/core/AetherRouter.js'; // Added

// --- Utilities ---
import envLoader from './src/utils/env-loader.js';
import memoryPool from './src/utils/memory-pool.js';
import atomicOps from './src/utils/atomic-ops.js';

// --- Middleware Factories ---
import createRateLimit from './src/middleware/rate-limit.js';
import createSecurity from './src/middleware/security.js';
import createBodyParser from './src/middleware/body-parser.js';
import createCors from './src/middleware/cors.js';
import createCompression from './src/middleware/compression.js';
import createJwt from './src/middleware/jwt.js';
import SessionManager from './src/middleware/session.js';
import createJson from './src/middleware/json.js';

// 修复：使用命名导入而不是默认导入
import { createRouter } from './src/middleware/router.js'; // 改为命名导入
import createParamsMiddleware from './src/middleware/params.js';

// Export all components
export {
    AetherContext,
    AetherPipeline,
    AetherStore,
    AetherCompiler,
    AetherRouter // Added
};

// Export utility functions
export const utils = {
    envLoader,
    memoryPool,
    atomicOps
};

// Export middleware factory functions
export const middleware = {
    rateLimit: createRateLimit,
    security: createSecurity,
    bodyParser: createBodyParser,
    cors: createCors,
    compression: createCompression,
    jwt: createJwt,
    session: SessionManager,
    json: createJson,
    router: createRouter, // 这里使用导入的 createRouter
    params: createParamsMiddleware 
};

// Default export
export default {
    AetherContext,
    AetherPipeline,
    AetherStore,
    AetherCompiler,
    AetherRouter, 
    utils,
    middleware
};
