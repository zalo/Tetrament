/**
 * Structured array for GPU buffer management
 * Uses proper TSL struct types for WebGPU shader compatibility
 * @module tetrament/core/StructuredArray
 */

import { struct, instancedArray } from 'three/tsl';

/**
 * Type information for struct fields
 */
const TYPES = {
    int: { size: 1, alignment: 1, isFloat: false },
    uint: { size: 1, alignment: 1, isFloat: false },
    float: { size: 1, alignment: 1, isFloat: true },

    vec2: { size: 2, alignment: 2, isFloat: true },
    ivec2: { size: 2, alignment: 2, isFloat: false },
    uvec2: { size: 2, alignment: 2, isFloat: false },

    vec3: { size: 3, alignment: 4, isFloat: true },
    ivec3: { size: 3, alignment: 4, isFloat: false },
    uvec3: { size: 3, alignment: 4, isFloat: false },

    vec4: { size: 4, alignment: 4, isFloat: true },
    ivec4: { size: 4, alignment: 4, isFloat: false },
    uvec4: { size: 4, alignment: 4, isFloat: false },

    mat2: { size: 4, alignment: 2, isFloat: true },
    mat3: { size: 12, alignment: 4, isFloat: true },
    mat4: { size: 16, alignment: 4, isFloat: true },
};

/**
 * GPU structured array for managing typed buffer data
 * Uses TSL struct() for proper WebGPU shader compatibility
 */
export class StructuredArray {
    structNode = null;
    buffer = null;
    layout = null;
    structSize = 0;

    /**
     * @param {Object} layoutDef - Structure definition (e.g., { position: 'vec3', velocity: 'vec3' })
     * @param {number} length - Number of elements
     * @param {string} [label='data'] - Buffer label for debugging
     */
    constructor(layoutDef, length, label = 'data') {
        this.layout = this._parse(layoutDef);
        this.length = length;

        // Create TSL struct type - this is critical for WebGPU shader compilation
        this.structNode = struct(this.layout);

        // Create typed arrays for CPU-side data manipulation
        this.floatArray = new Float32Array(this.structSize * this.length);
        this.intArray = new Int32Array(this.floatArray.buffer);

        // Create instancedArray with the struct type - this enables proper shader access
        this.buffer = instancedArray(this.floatArray, this.structNode).setName(label);
    }

    /**
     * Sets a value in the buffer (CPU-side)
     * @param {number} index - Element index
     * @param {string} element - Field name
     * @param {*} value - Value to set (number, array, or object with x,y,z,w)
     */
    set(index, element, value) {
        const member = this.layout[element];
        if (!member) {
            console.error("Unknown element '" + element + "'");
            return;
        }
        const offset = index * this.structSize + member.offset;
        const array = member.isFloat ? this.floatArray : this.intArray;

        if (member.size === 1) {
            if (typeof value !== 'number') {
                console.error("Expected a Number value for element '" + element + "'");
                return;
            }
            array[offset] = value;
        }
        if (member.size > 1) {
            if (typeof value === 'object' && !Array.isArray(value)) {
                const obj = value;
                value = [obj.x, obj.y || 0, obj.z || 0, obj.w || 0];
            }
            if (!Array.isArray(value) || value.length < member.size) {
                console.error("Expected an array of length " + member.size + " for element '" + element + "'");
                return;
            }
            for (let i = 0; i < member.size; i++) {
                array[offset + i] = value[i];
            }
        }
    }

    /**
     * Gets a TSL accessor for reading from the buffer in shaders
     * Uses proper struct member access via .get()
     * @param {*} index - Element index (can be TSL node)
     * @param {string} element - Field name
     * @returns {*} TSL accessor for shader use
     */
    get(index, element) {
        // Use proper TSL struct access: buffer.element(index).get(fieldName)
        return this.buffer.element(index).get(element);
    }

    /**
     * Parses the layout definition and calculates offsets with proper alignment
     * @private
     */
    _parse(layoutDef) {
        let offset = 0;
        const parsedLayout = {};

        const keys = Object.keys(layoutDef);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            let member = layoutDef[key];

            // Handle string shorthand (e.g., 'vec3' instead of { type: 'vec3' })
            if (typeof member === 'string' || member instanceof String) {
                member = { type: member };
            }

            const type = member.type;
            if (!TYPES[type]) {
                console.error("Unknown type '" + type + "'");
                return;
            }

            const { size, alignment, isFloat } = TYPES[type];
            member.size = size;
            member.isFloat = isFloat;

            // Apply alignment padding
            const rest = offset % alignment;
            if (rest !== 0) {
                offset += (alignment - rest);
            }
            member.offset = offset;
            offset += size;

            parsedLayout[key] = member;
        }

        // Ensure struct size is aligned to 4 (vec4 boundary)
        const rest = offset % 4;
        if (rest !== 0) {
            offset += (4 - rest);
        }

        this.structSize = offset;
        return parsedLayout;
    }

    /**
     * Gets the underlying Float32Array
     * @returns {Float32Array}
     */
    getArray() {
        return this.floatArray;
    }

    /**
     * Gets the TSL buffer
     * @returns {*}
     */
    getBuffer() {
        return this.buffer;
    }
}
