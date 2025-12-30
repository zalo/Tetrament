/**
 * Anchor control for pinning softbody vertices to transforms
 * @module tetrament/controls/AnchorControl
 */

import * as THREE from 'three';
import {
    Fn,
    instanceIndex,
    vec3,
    float,
    If,
    Return,
    uniform,
    instancedArray,
    length,
    mix
} from 'three/tsl';

/**
 * Anchor definition
 * @typedef {Object} AnchorDef
 * @property {THREE.Vector3} position - Anchor position in local space
 * @property {number} radius - Influence radius
 * @property {THREE.Object3D} [target] - Target transform to follow
 * @property {number} [strength=1] - Anchor strength (0-1)
 */

/**
 * Controls vertex anchoring to transforms
 */
export class AnchorControl {
    /**
     * @param {SoftbodySimulation} simulation - Physics simulation
     * @param {number} [maxAnchors=32] - Maximum number of anchors
     */
    constructor(simulation, maxAnchors = 32) {
        this.simulation = simulation;
        this.maxAnchors = maxAnchors;
        this.anchors = [];
        this.enabled = true;

        // Anchor data buffers
        this.anchorPositions = new Float32Array(maxAnchors * 4); // vec4 (xyz + radius)
        this.anchorTargets = new Float32Array(maxAnchors * 4);   // vec4 (xyz + strength)
        this.anchorCount = 0;

        this._initialized = false;
    }

    /**
     * Initializes GPU resources
     */
    initialize() {
        if (this._initialized) return;

        const { vertexBuffer, objectBuffer } = this.simulation.buffers;

        // Create anchor buffers
        this.anchorPositionBuffer = instancedArray(this.anchorPositions, 'vec4');
        this.anchorTargetBuffer = instancedArray(this.anchorTargets, 'vec4');
        this.uniforms = {
            anchorCount: uniform(0, 'int')
        };

        // Create anchor constraint kernel
        this.kernel = Fn(() => {
            If(instanceIndex.greaterThanEqual(this.simulation.uniforms.vertexCount), () => Return());

            const objectId = vertexBuffer.get(instanceIndex, 'objectId');
            const size = objectBuffer.get(objectId, 'size');
            If(size.lessThan(0.0001), () => Return());

            const position = vertexBuffer.get(instanceIndex, 'position').toVar();
            const initialPosition = vertexBuffer.get(instanceIndex, 'initialPosition');

            // Check each anchor
            for (let i = 0; i < this.maxAnchors; i++) {
                If(float(i).greaterThanEqual(this.uniforms.anchorCount), () => Return());

                const anchorPos = this.anchorPositionBuffer.element(i).xyz;
                const anchorRadius = this.anchorPositionBuffer.element(i).w;
                const targetPos = this.anchorTargetBuffer.element(i).xyz;
                const strength = this.anchorTargetBuffer.element(i).w;

                const dist = length(initialPosition.sub(anchorPos));
                If(dist.lessThan(anchorRadius), () => {
                    const influence = float(1).sub(dist.div(anchorRadius)).mul(strength);
                    position.assign(mix(position, targetPos.add(initialPosition.sub(anchorPos)), influence));
                });
            }

            vertexBuffer.get(instanceIndex, 'position').assign(position);
            vertexBuffer.get(instanceIndex, 'prevPosition').assign(position);
        })().compute(this.simulation.vertexCount);

        this.simulation.renderer.compute(this.kernel);
        this._initialized = true;
    }

    /**
     * Adds an anchor
     * @param {AnchorDef} anchorDef - Anchor definition
     * @returns {number} Anchor index
     */
    addAnchor(anchorDef) {
        if (this.anchors.length >= this.maxAnchors) {
            console.warn('[AnchorControl] Maximum anchors reached');
            return -1;
        }

        const index = this.anchors.length;
        const anchor = {
            position: anchorDef.position.clone(),
            radius: anchorDef.radius,
            target: anchorDef.target ?? null,
            strength: anchorDef.strength ?? 1,
            targetPosition: anchorDef.position.clone()
        };

        this.anchors.push(anchor);
        this._updateAnchorBuffer(index);
        this.anchorCount = this.anchors.length;

        return index;
    }

    /**
     * Removes an anchor
     * @param {number} index - Anchor index
     */
    removeAnchor(index) {
        if (index < 0 || index >= this.anchors.length) return;

        this.anchors.splice(index, 1);
        this.anchorCount = this.anchors.length;

        // Rebuild buffers
        for (let i = 0; i < this.anchors.length; i++) {
            this._updateAnchorBuffer(i);
        }
    }

    /**
     * Updates anchor buffer data
     * @param {number} index - Anchor index
     */
    _updateAnchorBuffer(index) {
        const anchor = this.anchors[index];
        const i = index * 4;

        this.anchorPositions[i] = anchor.position.x;
        this.anchorPositions[i + 1] = anchor.position.y;
        this.anchorPositions[i + 2] = anchor.position.z;
        this.anchorPositions[i + 3] = anchor.radius;

        this.anchorTargets[i] = anchor.targetPosition.x;
        this.anchorTargets[i + 1] = anchor.targetPosition.y;
        this.anchorTargets[i + 2] = anchor.targetPosition.z;
        this.anchorTargets[i + 3] = anchor.strength;
    }

    /**
     * Updates the anchor control (call each frame)
     */
    update() {
        if (!this.enabled || !this._initialized || this.anchors.length === 0) return;

        // Update target positions from transforms
        for (let i = 0; i < this.anchors.length; i++) {
            const anchor = this.anchors[i];
            if (anchor.target) {
                anchor.target.getWorldPosition(anchor.targetPosition);
            }
            this._updateAnchorBuffer(i);
        }

        // Update uniforms
        this.uniforms.anchorCount.value = this.anchorCount;

        // Run anchor constraint
        this.simulation.renderer.compute(this.kernel);
    }

    /**
     * Sets anchor position
     * @param {number} index - Anchor index
     * @param {THREE.Vector3} position - New position
     */
    setAnchorPosition(index, position) {
        if (index < 0 || index >= this.anchors.length) return;
        this.anchors[index].position.copy(position);
        this._updateAnchorBuffer(index);
    }

    /**
     * Sets anchor target
     * @param {number} index - Anchor index
     * @param {THREE.Object3D} target - Target transform
     */
    setAnchorTarget(index, target) {
        if (index < 0 || index >= this.anchors.length) return;
        this.anchors[index].target = target;
    }

    /**
     * Sets anchor strength
     * @param {number} index - Anchor index
     * @param {number} strength - Strength (0-1)
     */
    setAnchorStrength(index, strength) {
        if (index < 0 || index >= this.anchors.length) return;
        this.anchors[index].strength = strength;
        this._updateAnchorBuffer(index);
    }

    /**
     * Gets all anchors
     * @returns {Array} Anchors
     */
    getAnchors() {
        return this.anchors;
    }

    /**
     * Disposes resources
     */
    dispose() {
        if (this.kernel) {
            this.kernel.dispose();
        }
    }
}
