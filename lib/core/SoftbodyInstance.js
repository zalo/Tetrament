/**
 * Softbody instance representing a single softbody object
 * @module tetrament/core/SoftbodyInstance
 */

import * as THREE from 'three';

/**
 * Represents a single instance of a softbody geometry
 */
export class SoftbodyInstance {
    /**
     * @param {SoftbodySimulation} physics - Physics simulation
     * @param {SoftbodyGeometry} geometry - Parent geometry
     */
    constructor(physics, geometry) {
        this.physics = physics;
        this.geometry = geometry;
        this.spawned = false;

        // Register with physics
        const objectParams = physics._addObject(this);
        this.id = objectParams.id;
        this.params = objectParams;

        // Store offsets before adding data
        this.tetOffset = physics.tetCount;
        this.vertexOffset = physics.vertexCount;

        // Load model data
        this._loadModel(geometry.model);
    }

    /**
     * Loads the model data into the physics simulation
     * @param {Object} model - Model data
     */
    _loadModel(model) {
        const { tetVerts, tetIds } = model;

        // Add vertices
        const vertexMap = new Map();
        for (let i = 0; i < tetVerts.length; i += 3) {
            const vertex = this.physics.addVertex(
                this.id,
                tetVerts[i],
                tetVerts[i + 1],
                tetVerts[i + 2]
            );
            vertexMap.set(i / 3, vertex);
        }

        // Add tetrahedra
        for (let i = 0; i < tetIds.length; i += 4) {
            const v0 = vertexMap.get(tetIds[i]);
            const v1 = vertexMap.get(tetIds[i + 1]);
            const v2 = vertexMap.get(tetIds[i + 2]);
            const v3 = vertexMap.get(tetIds[i + 3]);
            this.physics.addTet(this.id, v0, v1, v2, v3);
        }
    }

    /**
     * Spawns the instance at a position
     * @param {THREE.Vector3} position - Position
     * @param {THREE.Quaternion} [quaternion] - Rotation
     * @param {THREE.Vector3} [scale] - Scale
     * @param {THREE.Vector3} [velocity] - Initial velocity
     */
    async spawn(position, quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1), velocity = new THREE.Vector3()) {
        this.spawned = true;
        // Store spawn params for potential respawn after rebake
        this.spawnParams = {
            position: position.clone(),
            quaternion: quaternion.clone(),
            scale: scale.clone(),
            velocity: velocity.clone()
        };
        await this.physics.resetObject(this.id, position, quaternion, scale, velocity);
    }

    /**
     * Despawns the instance
     */
    despawn() {
        this.spawned = false;
    }

    /**
     * Gets the current position of the instance
     * @returns {THREE.Vector3}
     */
    getPosition() {
        return this.physics.getPosition(this.id);
    }

    /**
     * Updates the instance (called each frame)
     * @param {number} deltaTime - Time since last frame
     * @param {number} elapsed - Total elapsed time
     */
    async update(deltaTime, elapsed) {
        // Override in subclass for custom behavior
    }
}
