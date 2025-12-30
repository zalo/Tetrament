/**
 * Spatial hashing grid for collision detection
 * Uses atomic buffer for thread-safe grid cell updates
 * @module tetrament/core/Grid
 */

import {
    instancedArray,
    instanceIndex,
    Fn,
    int,
    uint,
    ivec3,
    uvec3
} from 'three/tsl';
import { murmurHash13 } from './shaderMath.js';

/**
 * Spatial grid for accelerating collision detection
 * Uses atomic operations for thread-safe cell updates in compute shaders
 */
export class Grid {
    cellsize = 1;
    mode = '';
    buffer = null;

    /**
     * @param {number} cellsize - Size of each grid cell
     * @param {string} [mode='basic'] - Grid mode: 'basic' or 'hash'
     */
    constructor(cellsize, mode = 'basic') {
        this.cellsize = cellsize;
        this.mode = mode;

        if (mode === 'basic') {
            // 80^3 = 512,000 cells
            this.gridSize = 80;
            this.cellCount = this.gridSize ** 3;
        } else if (mode === 'hash') {
            // Hash table with prime size
            this.cellCount = 1048573; // Largest prime below 2^20
        } else {
            console.error("Unrecognized grid type");
        }

        // Create atomic buffer - critical for thread-safe grid cell updates
        // The .toAtomic() call enables atomic operations in shaders
        this.buffer = instancedArray(this.cellCount, 'int').toAtomic();

        // Create clear kernel that resets all cells to -1
        this.clearKernel = Fn(() => {
            this.buffer.setAtomic(false);
            this.buffer.element(instanceIndex).assign(int(-1));
        })().compute(this.cellCount);
    }

    /**
     * Clears the grid buffer (resets all cells to -1)
     * @param {THREE.WebGPURenderer} renderer
     */
    async clearBuffer(renderer) {
        await renderer.computeAsync(this.clearKernel);
    }

    /**
     * Gets the grid cell from an integer index (TSL)
     * Handles both basic (3D array) and hash modes
     * @param {*} ipos - Cell index (ivec3 TSL node)
     * @returns {*} Cell value (TSL node)
     */
    getElementFromIndex(ipos) {
        if (this.mode === 'basic') {
            // Convert to unsigned and wrap to grid size
            const upos = uvec3(ipos.add(1073741823)).mod(this.gridSize).toVar();
            const hash = upos.x.mul(this.gridSize * this.gridSize)
                .add(upos.y.mul(this.gridSize))
                .add(upos.z)
                .mod(this.cellCount)
                .toVar('hash');
            return this.buffer.element(hash);
        } else if (this.mode === 'hash') {
            const hash = murmurHash13(ipos).mod(uint(this.cellCount)).toVar('hash');
            return this.buffer.element(hash);
        }
    }

    /**
     * Gets the grid cell index from a position (TSL)
     * @param {*} pos - Position (TSL vec3 node)
     * @returns {*} Cell value (TSL node)
     */
    getElement(pos) {
        const ipos = ivec3(pos.div(this.cellsize).floor());
        return this.getElementFromIndex(ipos);
    }

    /**
     * Sets whether to use atomic operations for buffer access
     * Must be called before accessing buffer elements in shaders
     * @param {boolean} value - true for atomic ops, false for regular access
     */
    setAtomic(value) {
        this.buffer.setAtomic(value);
    }

    /**
     * Disposes resources
     */
    dispose() {
        if (this.clearKernel) {
            this.clearKernel.dispose();
        }
    }
}
