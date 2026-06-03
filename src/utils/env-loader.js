 /**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/utils/evn-loader
 */

import fs from 'fs';
import path from 'path';
/**
 * Parse .env file content
 * @param {string} content - .env file content
 * @returns {Object} - Parsed environment variables
 */
function parseEnvContent(content) {
    const env = {};
    const lines = content.split('\n');
    
    for (const line of lines) {
        // Skip comments and empty lines
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('#')) {
            continue;
        }
        
        // Split key=value
        const equalIndex = trimmedLine.indexOf('=');
        if (equalIndex === -1) {
            continue;
        }
        
        const key = trimmedLine.substring(0, equalIndex).trim();
        let value = trimmedLine.substring(equalIndex + 1).trim();
        
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.substring(1, value.length - 1);
        }
        
        // Set environment variable
        env[key] = value;
    }
    
    return env;
}

/**
 * Load environment variables from .env file
 * @param {string} envPath - Path to .env file
 * @param {boolean} override - Whether to override existing env vars
 * @returns {Object} - Loaded environment variables
 */
function loadEnv(envPath = '.env', override = false) {
    const absolutePath = path.resolve(process.cwd(), envPath);
    
    if (!fs.existsSync(absolutePath)) {
        console.warn(`AetherJS: .env file not found at ${absolutePath}`);
        return {};
    }
    
    try {
        const content = fs.readFileSync(absolutePath, 'utf8');
        const env = parseEnvContent(content);
        
        // Set environment variables
        for (const [key, value] of Object.entries(env)) {
            if (override || process.env[key] === undefined) {
                process.env[key] = value;
            }
        }
        
        return env;
    } catch (error) {
        console.error(`AetherJS: Error loading .env file: ${error.message}`);
        return {};
    }
}

/**
 * Watch .env file for changes and reload
 * @param {string} envPath - Path to .env file
 * @param {Function} callback - Callback when env changes
 * @returns {Object} - Watcher object with close method
 */
function watchEnv(envPath = '.env', callback) {
    const absolutePath = path.resolve(process.cwd(), envPath);
    
    if (!fs.existsSync(absolutePath)) {
        console.warn(`AetherJS: .env file not found at ${absolutePath}`);
        return { close: () => {} };
    }
    
    let lastContent = fs.readFileSync(absolutePath, 'utf8');
    
    const watcher = fs.watch(absolutePath, (eventType) => {
        if (eventType === 'change') {
            try {
                const newContent = fs.readFileSync(absolutePath, 'utf8');
                if (newContent !== lastContent) {
                    lastContent = newContent;
                    const newEnv = parseEnvContent(newContent);
                    
                    // Update process.env
                    for (const [key, value] of Object.entries(newEnv)) {
                        process.env[key] = value;
                    }
                    
                    if (callback) {
                        callback(newEnv);
                    }
                }
            } catch (error) {
                console.error(`AetherJS: Error reloading .env file: ${error.message}`);
            }
        }
    });
    
    return {
        close: () => watcher.close()
    };
}
export default {
    loadEnv,
    watchEnv,
    parseEnvContent
};

