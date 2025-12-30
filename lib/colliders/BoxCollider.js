/**
 * Box collider for softbody simulation
 * @module tetrament/colliders/BoxCollider
 */

import * as THREE from 'three';
import { vec4, vec3, abs, max, min, length, normalize, sign, uniform, select } from 'three/tsl';

/**
 * Creates a box collider function (axis-aligned)
 * @param {THREE.Vector3} center - Center of the box
 * @param {THREE.Vector3} halfExtents - Half-size in each dimension
 * @param {boolean} [inside=false] - If true, keeps objects inside the box
 * @returns {Function} TSL collider function
 */
export function BoxCollider(center, halfExtents, inside = false) {
    const centerVec = vec3(center.x, center.y, center.z);
    const halfExt = vec3(halfExtents.x, halfExtents.y, halfExtents.z);

    return (position) => {
        // Transform to box space
        const local = position.sub(centerVec);
        const absLocal = abs(local);

        // Distance to each face
        const d = absLocal.sub(halfExt);

        if (inside) {
            // Inside box SDF (negative inside)
            const outsideDist = length(max(d, vec3(0)));
            const insideDist = min(max(d.x, max(d.y, d.z)), 0);
            const signedDist = outsideDist.add(insideDist).negate();

            // Normal points inward
            const maxComp = max(d.x, max(d.y, d.z));
            const normal = vec3(
                select(d.x.equal(maxComp), sign(local.x).negate(), 0),
                select(d.y.equal(maxComp), sign(local.y).negate(), 0),
                select(d.z.equal(maxComp), sign(local.z).negate(), 0)
            );

            return vec4(normalize(normal), signedDist);
        } else {
            // Outside box SDF (negative inside)
            const outsideDist = length(max(d, vec3(0)));
            const insideDist = min(max(d.x, max(d.y, d.z)), 0);
            const signedDist = outsideDist.add(insideDist);

            // Normal points outward
            const maxComp = max(d.x, max(d.y, d.z));
            const normal = vec3(
                select(d.x.equal(maxComp), sign(local.x), 0),
                select(d.y.equal(maxComp), sign(local.y), 0),
                select(d.z.equal(maxComp), sign(local.z), 0)
            );

            return vec4(normalize(normal), signedDist);
        }
    };
}

/**
 * Creates a dynamic box collider that can be moved
 * @param {THREE.Vector3} halfExtents - Half-size in each dimension
 * @param {boolean} [inside=false] - If true, keeps objects inside
 * @returns {Object} Collider with update function
 */
export function DynamicBoxCollider(halfExtents, inside = false) {
    const centerUniform = uniform(new THREE.Vector3());
    const halfExt = vec3(halfExtents.x, halfExtents.y, halfExtents.z);

    const colliderFn = (position) => {
        const local = position.sub(centerUniform.value);
        const absLocal = abs(local);
        const d = absLocal.sub(halfExt);

        const outsideDist = length(max(d, vec3(0)));
        const insideDist = min(max(d.x, max(d.y, d.z)), 0);

        if (inside) {
            const signedDist = outsideDist.add(insideDist).negate();
            const maxComp = max(d.x, max(d.y, d.z));
            const normal = normalize(vec3(
                select(d.x.equal(maxComp), sign(local.x).negate(), 0),
                select(d.y.equal(maxComp), sign(local.y).negate(), 0),
                select(d.z.equal(maxComp), sign(local.z).negate(), 0)
            ));
            return vec4(normal, signedDist);
        } else {
            const signedDist = outsideDist.add(insideDist);
            const maxComp = max(d.x, max(d.y, d.z));
            const normal = normalize(vec3(
                select(d.x.equal(maxComp), sign(local.x), 0),
                select(d.y.equal(maxComp), sign(local.y), 0),
                select(d.z.equal(maxComp), sign(local.z), 0)
            ));
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
