/**
 * Sphere collider for softbody simulation
 * @module tetrament/colliders/SphereCollider
 */

import * as THREE from 'three';
import { vec4, vec3, float, length, normalize, uniform } from 'three/tsl';

/**
 * Creates a sphere collider function
 * @param {THREE.Vector3} center - Center of the sphere
 * @param {number} radius - Radius of the sphere
 * @param {boolean} [inside=false] - If true, keeps objects inside the sphere
 * @returns {Function} TSL collider function
 */
export function SphereCollider(center, radius, inside = false) {
    const centerVec = vec3(center.x, center.y, center.z);
    const radiusNode = float(radius);

    if (inside) {
        // Keep objects inside the sphere
        return (position) => {
            const toCenter = centerVec.sub(position);
            const dist = length(toCenter);
            const normal = normalize(toCenter);
            const signedDist = radiusNode.sub(dist);
            return vec4(normal, signedDist);
        };
    } else {
        // Keep objects outside the sphere
        return (position) => {
            const fromCenter = position.sub(centerVec);
            const dist = length(fromCenter);
            const normal = normalize(fromCenter);
            const signedDist = dist.sub(radiusNode);
            return vec4(normal, signedDist);
        };
    }
}

/**
 * Creates a dynamic sphere collider that can be moved
 * @param {number} radius - Radius of the sphere
 * @param {boolean} [inside=false] - If true, keeps objects inside
 * @returns {Object} Collider with update function
 */
export function DynamicSphereCollider(radius, inside = false) {
    const centerUniform = uniform(new THREE.Vector3());
    const radiusNode = float(radius);

    const colliderFn = (position) => {
        if (inside) {
            const toCenter = centerUniform.sub(position);
            const dist = length(toCenter);
            const normal = normalize(toCenter);
            const signedDist = radiusNode.sub(dist);
            return vec4(normal, signedDist);
        } else {
            const fromCenter = position.sub(centerUniform);
            const dist = length(fromCenter);
            const normal = normalize(fromCenter);
            const signedDist = dist.sub(radiusNode);
            return vec4(normal, signedDist);
        }
    };

    return {
        collider: colliderFn,
        setPosition(x, y, z) {
            if (x instanceof THREE.Vector3) {
                centerUniform.value.copy(x);
            } else {
                centerUniform.value.set(x, y, z);
            }
        }
    };
}
