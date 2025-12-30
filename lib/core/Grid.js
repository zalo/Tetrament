/**
 * Spatial hashing grid for collision detection
 * @module tetrament/core/Grid
 */

import {
    instancedArray,
    instanceIndex,
    Fn,
    int,
    uint,
    ivec3,
    Return,
    atomicStore
} from 'three/tsl';
import { murmurHash13 } from './shaderMath.js';

/**
 * Spatial grid for accelerating collision detection
 */
export class Grid {
    /**
     * @param {number} cellsize - Size of each grid cell
     * @param {string} [mode='basic'] - Grid mode: 'basic' or 'hash'
     */
    constructor(cellsize, mode = 'basic') {
        this.cellsize = cellsize;
        this.mode = mode;
        this.atomic = false;

        if (mode === 'basic') {
            // 80^3 = 512,000 cells
            this.gridSize = 80;
            this.cellCount = this.gridSize ** 3;
        } else {
            // Hash table with prime size
            this.cellCount = 1048573; // Large prime
        }

        this.array = new Int32Array(this.cellCount).fill(-1);
        this.buffer = instancedArray(this.array, 'int');
        this.clearKernel = null;
    }

    /**
     * Sets whether to use atomic operations
     * @param {boolean} value
     */
    setAtomic(value) {
        this.atomic = value;
    }

    /**
     * Gets the grid cell index from a position (TSL)
     * @param {*} position - Position (TSL node)
     * @returns {*} Cell index
     */
    getElement(position) {
        const cellIndex = ivec3(position.div(this.cellsize).floor());

        if (this.mode === 'basic') {
            const wrapped = cellIndex.mod(this.gridSize);
            const index = wrapped.x.mul(this.gridSize * this.gridSize)
                .add(wrapped.y.mul(this.gridSize))
                .add(wrapped.z);
            return this.buffer.element(index);
        } else {
            const hash = murmurHash13(cellIndex).mod(this.cellCount);
            return this.buffer.element(hash);
        }
    }

    /**
     * Gets the grid cell from an integer index (TSL)
     * @param {*} cellIndex - Cell index (ivec3 TSL node)
     * @returns {*} Cell value
     */
    getElementFromIndex(cellIndex) {
        if (this.mode === 'basic') {
            const wrapped = cellIndex.mod(this.gridSize);
            const index = wrapped.x.mul(this.gridSize * this.gridSize)
                .add(wrapped.y.mul(this.gridSize))
                .add(wrapped.z);
            return this.buffer.element(index);
        } else {
            const hash = murmurHash13(cellIndex).mod(this.cellCount);
            return this.buffer.element(hash);
        }
    }

    /**
     * Clears the grid buffer
     * @param {THREE.WebGPURenderer} renderer
     */
    async clearBuffer(renderer) {
        if (!this.clearKernel) {
            this.clearKernel = Fn(() => {
                atomicStore(this.buffer.element(instanceIndex), int(-1));
            })().compute(this.cellCount);
            await renderer.computeAsync(this.clearKernel);
        }
        await renderer.computeAsync(this.clearKernel);
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
