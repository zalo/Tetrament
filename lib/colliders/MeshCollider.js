/**
 * Mesh collider using three-mesh-bvh for softbody simulation
 * Note: This is a CPU-based collider that requires position readback
 * @module tetrament/colliders/MeshCollider
 */

import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

// Extend THREE.js with BVH methods
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/**
 * CPU-based mesh collider using BVH for distance queries
 * This collider works on the CPU side and requires position readback
 */
export class MeshCollider {
    /**
     * @param {THREE.BufferGeometry|THREE.Mesh} geometryOrMesh - Geometry or mesh to use as collider
     * @param {Object} [options] - Options
     * @param {number} [options.margin=0.01] - Collision margin
     */
    constructor(geometryOrMesh, options = {}) {
        this.margin = options.margin ?? 0.01;

        if (geometryOrMesh.isMesh) {
            this.mesh = geometryOrMesh;
            this.geometry = geometryOrMesh.geometry;
        } else {
            this.geometry = geometryOrMesh;
            this.mesh = new THREE.Mesh(this.geometry);
        }

        // Build BVH
        if (!this.geometry.boundsTree) {
            this.geometry.computeBoundsTree();
        }
        this.bvh = this.geometry.boundsTree;

        // Temporary vectors
        this._point = new THREE.Vector3();
        this._normal = new THREE.Vector3();
        this._closestPoint = new THREE.Vector3();
    }

    /**
     * Gets the closest point on the mesh surface to a query point
     * @param {THREE.Vector3} point - Query point
     * @param {THREE.Vector3} [target] - Target vector for result
     * @returns {Object} Result with point, distance, and normal
     */
    closestPointToPoint(point, target = new THREE.Vector3()) {
        const result = this.bvh.closestPointToPoint(point, target);
        return result;
    }

    /**
     * Checks if a point is inside the mesh
     * @param {THREE.Vector3} point - Point to test
     * @returns {boolean} True if inside
     */
    isInside(point) {
        const raycaster = new THREE.Raycaster();
        const directions = [
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, 0, 1)
        ];

        let insideCount = 0;
        for (const dir of directions) {
            raycaster.set(point, dir);
            raycaster.firstHitOnly = false;
            const hits = raycaster.intersectObject(this.mesh);
            if (hits.length % 2 === 1) {
                insideCount++;
            }
        }

        return insideCount >= 2;
    }

    /**
     * Computes signed distance from a point to the mesh
     * Negative = inside, Positive = outside
     * @param {THREE.Vector3} point - Query point
     * @returns {Object} Result with distance, normal, and closestPoint
     */
    signedDistance(point) {
        const closest = this.closestPointToPoint(point, this._closestPoint);

        if (!closest) {
            return { distance: Infinity, normal: new THREE.Vector3(0, 1, 0), closestPoint: null };
        }

        const distance = point.distanceTo(closest.point);
        const normal = this._normal.subVectors(point, closest.point).normalize();

        // Check if inside
        const inside = this.isInside(point);

        return {
            distance: inside ? -distance : distance,
            normal: inside ? normal.negate() : normal,
            closestPoint: closest.point.clone()
        };
    }

    /**
     * Resolves collision for a point
     * @param {THREE.Vector3} point - Point to resolve
     * @param {THREE.Vector3} [velocity] - Velocity for friction
     * @returns {Object|null} Resolution with newPosition and normal, or null if no collision
     */
    resolveCollision(point, velocity) {
        const result = this.signedDistance(point);

        if (result.distance < this.margin) {
            const penetration = this.margin - result.distance;
            const newPosition = point.clone().addScaledVector(result.normal, penetration);
            return {
                newPosition,
                normal: result.normal,
                penetration
            };
        }

        return null;
    }

    /**
     * Updates the mesh transform (for animated colliders)
     * @param {THREE.Matrix4} matrix - World matrix
     */
    updateMatrix(matrix) {
        this.mesh.matrixWorld.copy(matrix);
        this.mesh.matrixWorldNeedsUpdate = true;
    }

    /**
     * Disposes resources
     */
    dispose() {
        if (this.geometry.boundsTree) {
            this.geometry.disposeBoundsTree();
        }
    }
}

/**
 * Creates a simple plane collider function (GPU-compatible)
 * For complex mesh colliders, use MeshCollider class with CPU processing
 * @param {THREE.Vector3} normal - Plane normal
 * @param {number} distance - Distance from origin
 * @returns {Function} TSL collider function
 */
export function createPlaneColliderFromMesh(normal, distance) {
    const { PlaneCollider } = require('./PlaneCollider.js');
    return PlaneCollider(normal, distance);
}
