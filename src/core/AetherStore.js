/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/core/AetherStore
 * 
 * Ultra-Optimized Memory Store with Zero Statistics Overhead
 * Removed all monitoring, event emissions, and performance counters
 * Focus: Pure storage operations with maximum speed
 */

/**
 * MemoryStore - High-performance in-memory storage with LRU eviction
 * Removed all statistics, events, and monitoring for maximum speed
 */
class MemoryStore {
    constructor(options = {}) {
        // [PERF] Direct property assignment for V8 optimization
        this.maxSize = options.maxSize || 10000;
        this.ttl = options.ttl || 3600000; // 1 hour default TTL
        
        // [PERF] Use Map for O(1) operations
        this.store = new Map();
        
        // [PERF] Simple LRU tracking - array is faster than linked list for small sizes
        this.lru = [];
        
        // [PERF] No EventEmitter inheritance - removed all event overhead
        // [PERF] No statistics tracking - removed hits, misses, sets counters
        
        // [PERF] Cleanup interval with unref to prevent blocking shutdown
        this.cleanupInterval = setInterval(() => this._cleanup(), 60000).unref();
    }
    
    /**
     * Get value by key with LRU update
     * @param {string} key - Storage key
     * @returns {Promise<any>} - Stored value or null
     */
    async get(key) {
        const entry = this.store.get(key);
        
        // [PERF] Fast null check
        if (!entry) return null;
        
        // [PERF] Check expiration without Date.now() call if no TTL
        if (entry.expires && Date.now() > entry.expires) {
            // [PERF] Direct deletion without statistics
            this.store.delete(key);
            this._removeFromLRU(key);
            return null;
        }
        
        // [PERF] Update LRU position
        this._updateLRU(key);
        
        return entry.value;
    }
    
    /**
     * Set value with optional TTL
     * @param {string} key - Storage key
     * @param {any} value - Value to store
     * @param {number} ttl - Time to live in milliseconds
     * @returns {Promise<void>}
     */
    async set(key, value, ttl = this.ttl) {
        // [PERF] Check if key exists for LRU update
        if (this.store.has(key)) {
            this._updateLRU(key);
        } else {
            // [PERF] Evict if at capacity
            if (this.store.size >= this.maxSize) {
                this._evict();
            }
            this.lru.push(key);
        }
        
        // [PERF] Calculate expiration only if TTL provided
        const expires = ttl ? Date.now() + ttl : null;
        
        // [PERF] Store entry with minimal metadata
        this.store.set(key, {
            value,
            expires,
            createdAt: Date.now()
        });
    }
    
    /**
     * Delete key from store
     * @param {string} key - Key to delete
     * @returns {Promise<boolean>} - True if deleted, false if not found
     */
    async delete(key) {
        const deleted = this.store.delete(key);
        if (deleted) {
            this._removeFromLRU(key);
        }
        return deleted;
    }
    
    /**
     * Clear all stored data
     * @returns {Promise<void>}
     */
    async clear() {
        this.store.clear();
        this.lru = [];
        // [PERF] No statistics reset needed
    }
    
    /**
     * Check if key exists and is not expired
     * @param {string} key - Key to check
     * @returns {Promise<boolean>} - True if exists and valid
     */
    async has(key) {
        const entry = this.store.get(key);
        if (!entry) return false;
        
        // [PERF] Check expiration
        if (entry.expires && Date.now() > entry.expires) {
            this.store.delete(key);
            this._removeFromLRU(key);
            return false;
        }
        
        this._updateLRU(key);
        return true;
    }
    
    /**
     * Get all keys in store (excluding expired)
     * @returns {Promise<string[]>} - Array of keys
     */
    async keys() {
        const now = Date.now();
        const validKeys = [];
        
        // [PERF] Manual iteration avoids Array.from overhead
        for (const [key, entry] of this.store.entries()) {
            if (!entry.expires || now <= entry.expires) {
                validKeys.push(key);
            }
        }
        
        return validKeys;
    }
    
    /**
     * Get current store size (excluding expired entries)
     * @returns {Promise<number>} - Number of valid entries
     */
    async size() {
        // [PERF] Count only non-expired entries
        if (this.ttl === 0) {
            return this.store.size; // No expiration, all entries valid
        }
        
        const now = Date.now();
        let count = 0;
        
        for (const entry of this.store.values()) {
            if (!entry.expires || now <= entry.expires) {
                count++;
            }
        }
        
        return count;
    }
    
    /**
     * Update LRU order - move accessed key to end
     * @param {string} key - Accessed key
     * @private
     */
    _updateLRU(key) {
        const index = this.lru.indexOf(key);
        if (index > -1) {
            // [PERF] Splice is faster than filter for single element removal
            this.lru.splice(index, 1);
        }
        this.lru.push(key);
    }
    
    /**
     * Remove key from LRU list
     * @param {string} key - Key to remove
     * @private
     */
    _removeFromLRU(key) {
        const index = this.lru.indexOf(key);
        if (index > -1) {
            this.lru.splice(index, 1);
        }
    }
    
    /**
     * Evict least recently used item when at capacity
     * @private
     */
    _evict() {
        if (this.lru.length === 0) return;
        
        // [PERF] Shift is O(1) for array
        const oldestKey = this.lru.shift();
        this.store.delete(oldestKey);
        // [PERF] No statistics update
    }
    
    /**
     * Cleanup expired items
     * @private
     */
    _cleanup() {
        const now = Date.now();
        let deleted = false;
        
        // [PERF] Iterate and collect expired keys
        for (const [key, entry] of this.store.entries()) {
            if (entry.expires && now > entry.expires) {
                this.store.delete(key);
                this._removeFromLRU(key);
                deleted = true;
            }
        }
        
        // [PERF] No event emission or statistics update
    }
    
    /**
     * Destroy store and cleanup resources
     */
    destroy() {
        clearInterval(this.cleanupInterval);
        this.store.clear();
        this.lru = [];
    }
}

/**
 * Factory function to create store instances
 * @param {Object} options - Store configuration
 * @returns {MemoryStore} - Store instance
 */
function createAetherStore(options = {}) {
    return new MemoryStore(options);
}

export default createAetherStore;
