/**
 * Plane collider for softbody simulation
 * @module tetrament/colliders/PlaneCollider
 */

import * as THREE from 'three';
import { vec4, dot, vec3 } from 'three/tsl';

/**
 * Creates a plane collider function for use in softbody simulation
 * @param {THREE.Vector3} [normal] - Plane normal (default: up)
 * @param {number} [distance=0] - Distance from origin along normal
 * @returns {Function} TSL collider function
 */
export function PlaneCollider(normal = new THREE.Vector3(0, 1, 0), distance = 0) {
    const normalVec = vec3(normal.x, normal.y, normal.z);
    const d = distance;

    return (position) => {
        const signedDist = dot(position, normalVec).sub(d);
        return vec4(normalVec, signedDist);
    };
}

/**
 * Creates a ground plane collider at y=0
 * @param {number} [height=0] - Height of the ground plane
 * @returns {Function} TSL collider function
 */
export function GroundPlane(height = 0) {
    return PlaneCollider(new THREE.Vector3(0, 1, 0), height);
}
