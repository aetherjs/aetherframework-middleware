 /**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/core/AetherStore
 */

import { EventEmitter } from 'events';

/**
 * Memory storage backend with LRU cache
 */
class MemoryStore extends EventEmitter {
    constructor(options = {}) {
        super();
        this.maxSize = options.maxSize || 10000;
        this.ttl = options.ttl || 3600000; // 1 hour
        this.store = new Map();
        this.lru = []; // List of keys in access order
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0,
            size: 0
        };
        
        // Start cleanup interval
        this.cleanupInterval = setInterval(() => this._cleanup(), 60000).unref();
    }
    
    async get(key) {
        const entry = this.store.get(key);
        
        if (!entry) {
            this.stats.misses++;
            return null;
        }
        
        // Check if expired
        if (entry.expires && Date.now() > entry.expires) {
            this.store.delete(key);
            this._removeFromLRU(key);
            this.stats.misses++;
            return null;
        }
        
        // Update LRU
        this._updateLRU(key);
        this.stats.hits++;
        
        return entry.value;
    }
    
    async set(key, value, ttl = this.ttl) {
        // If key exists, update LRU
        if (this.store.has(key)) {
            this._updateLRU(key);
        } else {
            // Check capacity
            if (this.store.size >= this.maxSize) {
                this._evict();
            }
            this.lru.push(key);
        }
        
        const expires = ttl ? Date.now() + ttl : null;
        
        this.store.set(key, {
            value,
            expires,
            createdAt: Date.now(),
            accessedAt: Date.now()
        });
        
        this.stats.sets++;
        this.stats.size = this.store.size;
        
        this.emit('set', { key, value });
    }
    
    async delete(key) {
        const deleted = this.store.delete(key);
        if (deleted) {
            this._removeFromLRU(key);
            this.stats.deletes++;
            this.stats.size = this.store.size;
            this.emit('delete', { key });
        }
        return deleted;
    }
    
    async clear() {
        this.store.clear();
        this.lru = [];
        this.stats = { hits: 0, misses: 0, sets: 0, deletes: 0, size: 0 };
        this.emit('clear');
    }
    
    async has(key) {
        const entry = this.store.get(key);
        if (!entry) return false;
        
        if (entry.expires && Date.now() > entry.expires) {
            this.store.delete(key);
            this._removeFromLRU(key);
            return false;
        }
        
        this._updateLRU(key);
        return true;
    }
    
    async keys() {
        return Array.from(this.store.keys());
    }
    
    async size() {
        return this.store.size;
    }
    
    /**
     * Update LRU order
     * @param {string} key 
     */
    _updateLRU(key) {
        const index = this.lru.indexOf(key);
        if (index > -1) {
            this.lru.splice(index, 1);
        }
        this.lru.push(key);
        
        // Update accessed time
        const entry = this.store.get(key);
        if (entry) {
            entry.accessedAt = Date.now();
        }
    }
    
    /**
     * Remove key from LRU list
     * @param {string} key 
     */
    _removeFromLRU(key) {
        const index = this.lru.indexOf(key);
        if (index > -1) {
            this.lru.splice(index, 1);
        }
    }
    
    /**
     * Evict least recently used item
     */
    _evict() {
        if (this.lru.length === 0) return;
        
        const oldestKey = this.lru.shift();
        this.store.delete(oldestKey);
        this.stats.size = this.store.size;
        this.emit('evict', { key: oldestKey });
    }
    
    /**
     * Cleanup expired items
     */
    _cleanup() {
        const now = Date.now();
        const keysToDelete = [];
        
        for (const [key, entry] of this.store.entries()) {
            if (entry.expires && now > entry.expires) {
                keysToDelete.push(key);
            }
        }
        
        for (const key of keysToDelete) {
            this.store.delete(key);
            this._removeFromLRU(key);
        }
        
        if (keysToDelete.length > 0) {
            this.stats.size = this.store.size;
            this.emit('cleanup', { count: keysToDelete.length });
        }
    }
    
    destroy() {
        clearInterval(this.cleanupInterval);
        this.clear();
    }
}

/**
 * Factory function to create store instances
 * @param {Object} options - Store configuration
 * @returns {MemoryStore} - Store instance
 */
function createAetherStore(options = {}) {
    // In a full implementation, this would switch between Memory, Redis, etc.
    // For now, we return the high-performance MemoryStore
    return new MemoryStore(options);
}

export default createAetherStore;
