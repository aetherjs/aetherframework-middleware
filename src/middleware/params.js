/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/middleware/middleware/params.js
 */

function createParamsMiddleware(options = {}) {
  const defaults = {
    // Parameter parsing configuration
    parseNumbers: true, // Auto-convert numbers
    parseBooleans: true, // Auto-convert booleans
    parseArrays: true, // Auto-convert arrays
    trimStrings: true, // Auto-trim strings
    
    // Validation configuration
    validation: {
      enabled: true,
      onError: (context, errors) => {
        context.setStatus(400).json({
          error: "Validation Error",
          message: "Invalid request parameters",
          details: errors
        });
      }
    }
  };

  const config = { ...defaults, ...options };

  // Parameter type conversion
  function parseValue(value, options) {
    if (value === undefined || value === null) return value;
    
    let result = String(value);
    
    // Trim strings
    if (options.trimStrings) {
      result = result.trim();
    }
    
    // Parse numbers
    if (options.parseNumbers && /^-?\d+(\.\d+)?$/.test(result)) {
      const num = parseFloat(result);
      if (!isNaN(num)) return num;
    }
    
    // Parse booleans
    if (options.parseBooleans) {
      const lower = result.toLowerCase();
      if (lower === "true") return true;
      if (lower === "false") return false;
      if (lower === "1") return true;
      if (lower === "0") return false;
    }
    
    // Parse arrays (comma-separated)
    if (options.parseArrays && result.includes(",")) {
      return result.split(",").map(item => parseValue(item.trim(), options));
    }
    
    return result;
  }

  // Validate parameters
  function validateParams(params, rules) {
    if (!config.validation.enabled || !rules) return null;
    
    const errors = [];
    
    for (const [key, rule] of Object.entries(rules)) {
      const value = params[key];
      const isRequired = rule.required !== false;
      
      // Required check
      if (isRequired && (value === undefined || value === null || value === "")) {
        errors.push({
          field: key,
          message: rule.message || `${key} is required`,
          type: "required"
        });
        continue;
      }
      
      // Type checking
      if (value !== undefined && value !== null) {
        if (rule.type === "number" && typeof value !== "number") {
          errors.push({
            field: key,
            message: rule.message || `${key} must be a number`,
            type: "type"
          });
        } else if (rule.type === "string" && typeof value !== "string") {
          errors.push({
            field: key,
            message: rule.message || `${key} must be a string`,
            type: "type"
          });
        } else if (rule.type === "boolean" && typeof value !== "boolean") {
          errors.push({
            field: key,
            message: rule.message || `${key} must be a boolean`,
            type: "type"
          });
        } else if (rule.type === "array" && !Array.isArray(value)) {
          errors.push({
            field: key,
            message: rule.message || `${key} must be an array`,
            type: "type"
          });
        } else if (rule.type === "object" && (typeof value !== "object" || Array.isArray(value))) {
          errors.push({
            field: key,
            message: rule.message || `${key} must be an object`,
            type: "type"
          });
        }
        
        // Length validation
        if (rule.minLength !== undefined && String(value).length < rule.minLength) {
          errors.push({
            field: key,
            message: rule.message || `${key} must be at least ${rule.minLength} characters`,
            type: "minLength"
          });
        }
        
        if (rule.maxLength !== undefined && String(value).length > rule.maxLength) {
          errors.push({
            field: key,
            message: rule.message || `${key} must be at most ${rule.maxLength} characters`,
            type: "maxLength"
          });
        }
        
        // Range validation
        if (rule.min !== undefined && Number(value) < rule.min) {
          errors.push({
            field: key,
            message: rule.message || `${key} must be at least ${rule.min}`,
            type: "min"
          });
        }
        
        if (rule.max !== undefined && Number(value) > rule.max) {
          errors.push({
            field: key,
            message: rule.message || `${key} must be at most ${rule.max}`,
            type: "max"
          });
        }
        
        // Pattern validation
        if (rule.pattern && !new RegExp(rule.pattern).test(String(value))) {
          errors.push({
            field: key,
            message: rule.message || `${key} does not match the required pattern`,
            type: "pattern"
          });
        }
        
        // Enum validation
        if (rule.enum && !rule.enum.includes(value)) {
          errors.push({
            field: key,
            message: rule.message || `${key} must be one of: ${rule.enum.join(", ")}`,
            type: "enum"
          });
        }
      }
    }
    
    return errors.length > 0 ? errors : null;
  }

  return async function paramsMiddleware(context, next) {
    // Merge all parameters
    const allParams = {
      ...context.params || {},
      ...context.query || {},
      ...(context.getState("parsedBody") || {})
    };
    
    // Parameter type conversion
    const parsedParams = {};
    for (const [key, value] of Object.entries(allParams)) {
      parsedParams[key] = parseValue(value, config);
    }
    
    // Set to context
    context.allParams = parsedParams;
    
    // Get validation rules (from route metadata)
    const validationRules = context.route?.validationRules;
    
    // Execute validation
    if (validationRules) {
      const errors = validateParams(parsedParams, validationRules);
      if (errors) {
        return config.validation.onError(context, errors);
      }
    }
    
    // Add convenience methods
    context.getParam = (key, defaultValue) => {
      return parsedParams[key] !== undefined ? parsedParams[key] : defaultValue;
    };
    
    context.hasParam = (key) => {
      return parsedParams[key] !== undefined;
    };
    
    context.requireParam = (key) => {
      const value = parsedParams[key];
      if (value === undefined) {
        throw new Error(`Parameter ${key} is required`);
      }
      return value;
    };
    
    if (typeof next === "function") {
      await next();
    }
  };
}

export default createParamsMiddleware;
