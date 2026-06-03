 /**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/utils/memory-pool
 */
class MemoryPool {
    constructor(options = {}) {
        this.bufferSize = options.bufferSize || 8192; // 8KB default
        this.poolSize = options.poolSize || 100;
        this.buffers = [];
        this.available = [];
        this.stats = {
            allocated: 0,
            reused: 0,
            created: 0
        };
        
        // Initialize pool
        for (let i = 0; i < this.poolSize; i++) {
            const buffer = Buffer.allocUnsafe(this.bufferSize);
            this.buffers.push(buffer);
            this.available.push(i);
        }
    }
    
    /**
     * Get a buffer from the pool
     * @returns {Buffer} - Buffer from pool
     */
    get() {
        if (this.available.length > 0) {
            const index = this.available.pop();
            this.stats.reused++;
            return this.buffers[index];
        }
        
        // Pool exhausted, create new buffer
        const buffer = Buffer.allocUnsafe(this.bufferSize);
        this.buffers.push(buffer);
        this.stats.created++;
        this.stats.allocated++;
        return buffer;
    }
    
    /**
     * Return a buffer to the pool
     * @param {Buffer} buffer - Buffer to return
     */
    release(buffer) {
        const index = this.buffers.indexOf(buffer);
        if (index !== -1 && !this.available.includes(index)) {
            // Clear buffer content for security
            buffer.fill(0);
            this.available.push(index);
        }
    }
    
    /**
     * Get pool statistics
     * @returns {Object} - Pool stats
     */
    getStats() {
        return {
            ...this.stats,
            totalBuffers: this.buffers.length,
            availableBuffers: this.available.length,
            utilization: ((this.buffers.length - this.available.length) / this.buffers.length * 100).toFixed(2) + '%'
        };
    }
    
    /**
     * Destroy pool and free memory
     */
    destroy() {
        this.buffers = [];
        this.available = [];
        this.stats = { allocated: 0, reused: 0, created: 0 };
    }
}

/**
 * Factory function to create memory pool instances
 * @param {Object} options - Pool configuration
 * @returns {MemoryPool} - Memory pool instance
 */
function createMemoryPool(options = {}) {
    return new MemoryPool(options);
}



export default createMemoryPool;