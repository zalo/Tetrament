/**
 * Capsule collider for softbody simulation
 * @module tetrament/colliders/CapsuleCollider
 */

import * as THREE from 'three';
import { vec4, vec3, length, normalize, clamp, dot, uniform } from 'three/tsl';

/**
 * Creates a capsule collider function
 * @param {THREE.Vector3} pointA - First endpoint of capsule axis
 * @param {THREE.Vector3} pointB - Second endpoint of capsule axis
 * @param {number} radius - Radius of the capsule
 * @returns {Function} TSL collider function
 */
export function CapsuleCollider(pointA, pointB, radius) {
    const a = vec3(pointA.x, pointA.y, pointA.z);
    const b = vec3(pointB.x, pointB.y, pointB.z);
    const r = radius;

    return (position) => {
        const pa = position.sub(a);
        const ba = b.sub(a);
        const h = clamp(dot(pa, ba).div(dot(ba, ba)), 0, 1);
        const closest = a.add(ba.mul(h));
        const diff = position.sub(closest);
        const dist = length(diff);
        const normal = normalize(diff);
        const signedDist = dist.sub(r);
        return vec4(normal, signedDist);
    };
}

/**
 * Creates a vertical capsule collider (common for character colliders)
 * @param {THREE.Vector3} center - Center position
 * @param {number} height - Total height of capsule
 * @param {number} radius - Radius of the capsule
 * @returns {Function} TSL collider function
 */
export function VerticalCapsuleCollider(center, height, radius) {
    const halfHeight = (height - 2 * radius) / 2;
    const pointA = new THREE.Vector3(center.x, center.y - halfHeight, center.z);
    const pointB = new THREE.Vector3(center.x, center.y + halfHeight, center.z);
    return CapsuleCollider(pointA, pointB, radius);
}

/**
 * Creates a dynamic capsule collider that can be moved
 * @param {number} length - Length of the capsule axis
 * @param {number} radius - Radius of the capsule
 * @param {THREE.Vector3} [axis] - Axis direction (default: up)
 * @returns {Object} Collider with update function
 */
export function DynamicCapsuleCollider(axisLength, radius, axis = new THREE.Vector3(0, 1, 0)) {
    const centerUniform = uniform(new THREE.Vector3());
    const axisNormalized = axis.clone().normalize();
    const halfLength = axisLength / 2;
    const axisVec = vec3(
        axisNormalized.x * halfLength,
        axisNormalized.y * halfLength,
        axisNormalized.z * halfLength
    );
    const r = radius;

    const colliderFn = (position) => {
        const center = centerUniform.value;
        const a = center.sub(axisVec);
        const b = center.add(axisVec);
        const pa = position.sub(a);
        const ba = b.sub(a);
        const h = clamp(dot(pa, ba).div(dot(ba, ba)), 0, 1);
        const closest = a.add(ba.mul(h));
        const diff = position.sub(closest);
        const dist = length(diff);
        const normal = normalize(diff);
        const signedDist = dist.sub(r);
        return vec4(normal, signedDist);
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
