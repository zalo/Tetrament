/**
 * Structured array for GPU buffer management
 * @module tetrament/core/StructuredArray
 */

import { storageObject, instancedArray, instanceIndex } from 'three/tsl';

/**
 * Type sizes in bytes/components
 */
const TYPE_SIZES = {
    float: 1,
    int: 1,
    uint: 1,
    vec2: 2,
    vec3: 4, // Padded to vec4 for alignment
    vec4: 4,
    ivec2: 2,
    ivec3: 4, // Padded
    ivec4: 4,
    uvec2: 2,
    uvec3: 4, // Padded
    uvec4: 4,
    mat3: 12, // 3 vec4s
    mat4: 16
};

/**
 * Get Float32Array value setter for a type
 */
function getTypeSetter(type) {
    switch (type) {
        case 'float':
        case 'int':
        case 'uint':
            return (array, offset, value) => {
                array[offset] = value;
            };
        case 'vec2':
        case 'ivec2':
        case 'uvec2':
            return (array, offset, value) => {
                array[offset] = value.x ?? value[0];
                array[offset + 1] = value.y ?? value[1];
            };
        case 'vec3':
        case 'ivec3':
        case 'uvec3':
            return (array, offset, value) => {
                array[offset] = value.x ?? value[0];
                array[offset + 1] = value.y ?? value[1];
                array[offset + 2] = value.z ?? value[2];
            };
        case 'vec4':
        case 'ivec4':
        case 'uvec4':
            return (array, offset, value) => {
                array[offset] = value.x ?? value[0];
                array[offset + 1] = value.y ?? value[1];
                array[offset + 2] = value.z ?? value[2];
                array[offset + 3] = value.w ?? value[3];
            };
        default:
            return (array, offset, value) => {
                array[offset] = value;
            };
    }
}

/**
 * GPU structured array for managing typed buffer data
 */
export class StructuredArray {
    /**
     * @param {Object} struct - Structure definition
     * @param {number} count - Number of elements
     * @param {string} [name='data'] - Buffer name
     */
    constructor(struct, count, name = 'data') {
        this.struct = struct;
        this.count = count;
        this.name = name;

        // Calculate offsets and stride
        this.offsets = {};
        this.setters = {};
        let offset = 0;

        for (const [key, type] of Object.entries(struct)) {
            this.offsets[key] = offset;
            this.setters[key] = getTypeSetter(type);
            offset += TYPE_SIZES[type];
        }

        this.stride = offset;
        this.array = new Float32Array(count * this.stride);
        this.buffer = instancedArray(this.array, 'float');
    }

    /**
     * Sets a value in the buffer
     * @param {number} index - Element index
     * @param {string} key - Field name
     * @param {*} value - Value to set
     */
    set(index, key, value) {
        const offset = index * this.stride + this.offsets[key];
        this.setters[key](this.array, offset, value);
    }

    /**
     * Gets a TSL accessor for reading from the buffer
     * @param {*} index - Element index (can be TSL node)
     * @param {string} key - Field name
     * @returns {*} TSL accessor
     */
    get(index, key) {
        const baseIndex = index.mul ? index.mul(this.stride) : index * this.stride;
        const offset = this.offsets[key];
        const type = this.struct[key];
        const finalIndex = baseIndex.add ? baseIndex.add(offset) : baseIndex + offset;

        switch (type) {
            case 'float':
                return this.buffer.element(finalIndex);
            case 'int':
                return this.buffer.element(finalIndex).toInt();
            case 'uint':
                return this.buffer.element(finalIndex).toUint();
            case 'vec2':
                return this.buffer.element(finalIndex).toVar().toVec2();
            case 'vec3':
                return storageObject(this.buffer.value, 'vec4', this.count).element(finalIndex.div ? finalIndex.div(4) : Math.floor(finalIndex / 4)).xyz;
            case 'vec4':
                return storageObject(this.buffer.value, 'vec4', this.count).element(finalIndex.div ? finalIndex.div(4) : Math.floor(finalIndex / 4));
            case 'ivec3':
                return storageObject(this.buffer.value, 'ivec4', this.count).element(finalIndex.div ? finalIndex.div(4) : Math.floor(finalIndex / 4)).xyz;
            case 'ivec4':
                return storageObject(this.buffer.value, 'ivec4', this.count).element(finalIndex.div ? finalIndex.div(4) : Math.floor(finalIndex / 4));
            case 'uvec3':
                return storageObject(this.buffer.value, 'uvec4', this.count).element(finalIndex.div ? finalIndex.div(4) : Math.floor(finalIndex / 4)).xyz;
            case 'uvec4':
                return storageObject(this.buffer.value, 'uvec4', this.count).element(finalIndex.div ? finalIndex.div(4) : Math.floor(finalIndex / 4));
            default:
                return this.buffer.element(finalIndex);
        }
    }

    /**
     * Gets the underlying typed array
     * @returns {Float32Array}
     */
    getArray() {
        return this.array;
    }

    /**
     * Gets the TSL buffer
     * @returns {*}
     */
    getBuffer() {
        return this.buffer;
    }
}
