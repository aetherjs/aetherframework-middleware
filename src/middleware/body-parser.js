/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/middleware/body-parser.js
 */

import { StringDecoder } from 'string_decoder';

/**
 * Parse size string to bytes
 * @param {string|number} size - Size string like '1mb', '2kb', or bytes count
 * @returns {number} - Size in bytes
 */
function parseSize(size) {
    if (typeof size === 'number') return size;
    if (typeof size !== 'string') return 0;

    const units = {
        'b': 1,
        'kb': 1024,
        'mb': 1024 * 1024,
        'gb': 1024 * 1024 * 1024
    };
    
    const parsedStr = size.toLowerCase();
    const match = parsedStr.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/);
    if (!match) {
        throw new Error(`Invalid size format: ${size}`);
    }
    
    // 💡 修复：正确读取捕获组
    const value = parseFloat(match[1]); // 第一捕获组：纯数字
    const unit = match[2];              // 第二捕获组：单位 (如 'mb')
    return value * (units[unit] || 1);
}

/**
 * Parse request body as buffer
 * @param {Object} request - HTTP request object
 * @param {number} limit - Maximum size in bytes
 * @returns {Promise<Buffer>} - Request body buffer
 */
async function parseBodyBuffer(request, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalLength = 0;
        
        request.on('data', (chunk) => {
            totalLength += chunk.length;
            
            if (totalLength > limit) {
                request.destroy();
                reject(new Error(`Request body exceeded limit of ${limit} bytes`));
                return;
            }
            
            chunks.push(chunk);
        });
        
        request.on('end', () => {
            resolve(Buffer.concat(chunks));
        });
        
        request.on('error', (error) => {
            reject(error);
        });
    });
}

/**
 * Parse request body as JSON
 * @param {Object} request - HTTP request object
 * @param {number} limit - Maximum size in bytes
 * @returns {Promise<Object>} - Parsed JSON object
 */
async function parseBodyJson(request, limit) {
    const buffer = await parseBodyBuffer(request, limit);
    const text = buffer.toString('utf8');
    
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`Invalid JSON: ${error.message}`);
    }
}

/**
 * Parse request body as URL-encoded
 * @param {Object} request - HTTP request object
 * @param {number} limit - Maximum size in bytes
 * @returns {Promise<Object>} - Parsed URL-encoded object
 */
async function parseBodyUrlEncoded(request, limit) {
    const buffer = await parseBodyBuffer(request, limit);
    const text = buffer.toString('utf8');
    
    const result = {};
    const pairs = text.split('&');
    
    for (const pair of pairs) {
        const [key, value] = pair.split('=');
        if (key) {
            result[decodeURIComponent(key)] = decodeURIComponent(value || '');
        }
    }
    
    return result;
}

/**
 * Parse request body as text
 * @param {Object} request - HTTP request object
 * @param {number} limit - Maximum size in bytes
 * @returns {Promise<string>} - Parsed text
 */
async function parseBodyText(request, limit) {
    const buffer = await parseBodyBuffer(request, limit);
    return buffer.toString('utf8');
}

/**
 * Create body parser middleware for AetherJS
 * @param {Object} options - Body parser configuration
 * @returns {Function} - Body parser middleware function
 */
function createBodyParserMiddleware(options = {}) {
    // Load configuration from environment variables
    const envConfig = {
        jsonLimit: process.env.BODY_LIMIT_JSON,
        urlencodedLimit: process.env.BODY_LIMIT_URLENCODED,
        textLimit: process.env.BODY_LIMIT_TEXT,
        rawLimit: process.env.BODY_LIMIT_RAW,
        enableJson: process.env.BODY_ENABLE_JSON,
        enableUrlencoded: process.env.BODY_ENABLE_URLENCODED,
        enableText: process.env.BODY_ENABLE_TEXT,
        enableRaw: process.env.BODY_ENABLE_RAW
    };

    // Default configuration
    const defaults = {
        json: {
            enabled: envConfig.enableJson !== 'false',
            limit: parseSize(envConfig.jsonLimit || '1mb'),
            strict: true,
            reviver: null
        },
        urlencoded: {
            enabled: envConfig.enableUrlencoded !== 'false',
            limit: parseSize(envConfig.urlencodedLimit || '1mb'),
            extended: false,
            parameterLimit: 1000
        },
        text: {
            enabled: envConfig.enableText !== 'false',
            limit: parseSize(envConfig.textLimit || '1mb'),
            defaultCharset: 'utf-8'
        },
        raw: {
            enabled: envConfig.enableRaw !== 'false',
            limit: parseSize(envConfig.rawLimit || '10mb'),
            type: 'application/octet-stream'
        }
    };

    // 💡 修复：安全的嵌套字段深层合并，防止 options 传参直接覆盖 defaults 细节配置
    const config = {
        json: { ...defaults.json, ...options.json },
        urlencoded: { ...defaults.urlencoded, ...options.urlencoded },
        text: { ...defaults.text, ...options.text },
        raw: { ...defaults.raw, ...options.raw }
    };
    
    // 转换各类型的解析上限
    if (options.json?.limit) config.json.limit = parseSize(options.json.limit);
    if (options.urlencoded?.limit) config.urlencoded.limit = parseSize(options.urlencoded.limit);
    if (options.text?.limit) config.text.limit = parseSize(options.text.limit);
    if (options.raw?.limit) config.raw.limit = parseSize(options.raw.limit);
    
    const parsers = new Map();
    
    if (config.json.enabled) {
        parsers.set('application/json', async (request) => {
            const data = await parseBodyJson(request, config.json.limit);
            if (config.json.reviver) {
                return JSON.parse(JSON.stringify(data), config.json.reviver);
            }
            return data;
        });
        
        parsers.set('application/json; charset=utf-8', parsers.get('application/json'));
        parsers.set('application/json; charset=utf8', parsers.get('application/json'));
    }
    
    if (config.urlencoded.enabled) {
        parsers.set('application/x-www-form-urlencoded', async (request) => {
            return await parseBodyUrlEncoded(request, config.urlencoded.limit);
        });
    }
    
    if (config.text.enabled) {
        parsers.set('text/plain', async (request) => {
            return await parseBodyText(request, config.text.limit);
        });
        
        parsers.set('text/html', parsers.get('text/plain'));
        parsers.set('text/xml', parsers.get('text/plain'));
        parsers.set('text/css', parsers.get('text/plain'));
        parsers.set('text/javascript', parsers.get('text/plain'));
    }
    
    if (config.raw.enabled) {
        parsers.set(config.raw.type, async (request) => {
            return await parseBodyBuffer(request, config.raw.limit);
        });
    }

    /**
     * Body parser middleware function (Fully Aligned to (context, next) standard)
     * @param {AetherContext} context - AetherJS execution context
     * @param {Function} next - Continuation callback
     */
    return async function bodyParserMiddleware(context, next) {
        // Skip if no body is expected
        if (context.method === 'GET' || context.method === 'HEAD') {
            return typeof next === 'function' ? next() : null;
        }
        
        const contentType = context.getHeader('content-type') || '';
        const contentLength = parseInt(context.getHeader('content-length')) || 0;
        
        // Skip if no content
        if (contentLength === 0) {
            return typeof next === 'function' ? next() : null;
        }
        
        // Check content type
        let parser = null;
        for (const [type, parserFunc] of parsers) {
            if (contentType.includes(type)) {
                parser = parserFunc;
                break;
            }
        }
        
        // If no parser found and raw is enabled, use raw parser
        if (!parser && config.raw.enabled) {
            parser = parsers.get(config.raw.type);
        }
        
        if (!parser) {
            // No suitable parser found, continue without parsing
            return typeof next === 'function' ? next() : null;
        }
        
        try {
            // Parse body
            const body = await parser(context._request);
            
            // Store parsed body in context state
            if (contentType.includes('application/json')) {
                context.setState('parsedBody', { json: body });
            } else if (contentType.includes('application/x-www-form-urlencoded')) {
                context.setState('parsedBody', { urlencoded: body });
            } else if (contentType.includes('text/')) {
                context.setState('parsedBody', { text: body });
            } else {
                context.setState('parsedBody', { raw: body });
            }
            
            // Add convenience methods to context
            context.body = body; // 触发我们在 AetherContext 加的 setter
            context.getBody = () => body;
            
            return typeof next === 'function' ? next() : null;
            
        } catch (error) {
            // Handle parsing errors
            if (error.message.includes('exceeded limit')) {
                context.setStatus(413).json({ 
                    error: 'Payload Too Large',
                    message: error.message 
                });
            } else if (error.message.includes('Invalid JSON')) {
                context.setStatus(400).json({ 
                    error: 'Bad Request',
                    message: 'Invalid JSON format'
                });
            } else {
                context.setStatus(400).json({ 
                    error: 'Bad Request',
                    message: error.message 
                });
            }
        }
    };
}

export default createBodyParserMiddleware;