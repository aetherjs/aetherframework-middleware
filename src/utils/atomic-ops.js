/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/middleware/utils/atomic-ops
 */


class AtomicCounter {
    constructor(initialValue = 0) {
        this.value = initialValue;
    }
    
    /**
     * Increment counter
     * @param {number} delta - Amount to increment
     * @returns {number} - New value
     */
    increment(delta = 1) {
        this.value += delta;
        return this.value;
    }
    
    /**
     * Decrement counter
     * @param {number} delta - Amount to decrement
     * @returns {number} - New value
     */
    decrement(delta = 1) {
        this.value -= delta;
        return this.value;
    }
    
    /**
     * Get current value
     * @returns {number} - Current value
     */
    get() {
        return this.value;
    }
    
    /**
     * Set value
     * @param {number} value - New value
     */
    set(value) {
        this.value = value;
    }
    
    /**
     * Compare and swap
     * @param {number} expected - Expected value
     * @param {number} newValue - New value
     * @returns {boolean} - Whether swap succeeded
     */
    compareAndSwap(expected, newValue) {
        if (this.value === expected) {
            this.value = newValue;
            return true;
        }
        return false;
    }
}

/**
 * AtomicFlag - Thread-safe boolean flag
 */
class AtomicFlag {
    constructor(initialValue = false) {
        this.value = initialValue;
    }
    
    /**
     * Set flag to true
     * @returns {boolean} - Previous value
     */
    set() {
        const prev = this.value;
        this.value = true;
        return prev;
    }
    
    /**
     * Set flag to false
     * @returns {boolean} - Previous value
     */
    clear() {
        const prev = this.value;
        this.value = false;
        return prev;
    }
    
    /**
     * Toggle flag
     * @returns {boolean} - New value
     */
    toggle() {
        this.value = !this.value;
        return this.value;
    }
    
    /**
     * Get current value
     * @returns {boolean} - Current value
     */
    get() {
        return this.value;
    }
}

/**
 * Factory functions
 */
function createAtomicCounter(initialValue = 0) {
    return new AtomicCounter(initialValue);
}

function createAtomicFlag(initialValue = false) {
    return new AtomicFlag(initialValue);
}

export default {
    createAtomicCounter,
    createAtomicFlag,
    AtomicCounter,
    AtomicFlag
};