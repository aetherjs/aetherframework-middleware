/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/middleware/router.js
 */


import AetherRouter from "../core/AetherRouter.js";

/**
 * Create router middleware for AetherJS
 * @param {Object} routes - Route definitions
 * @param {Object} options - Router options
 * @returns {Function} - Router middleware function
 */
function createRouterMiddleware(routes = {}, options = {}) {
  const router = new AetherRouter(options);
  
  // Register routes from configuration
  for (const [methodPath, handler] of Object.entries(routes)) {
    const [method, path] = methodPath.split(" ");
    if (method && path && handler) {
      router[method.toLowerCase()](path, handler);
    }
  }
  
  return router.middleware();
}


createRouterMiddleware.Router = AetherRouter;


export default createRouterMiddleware;
export { createRouterMiddleware as createRouter, AetherRouter };
