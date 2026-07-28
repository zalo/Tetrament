/**
 * Signed-distance-field collider baked from an arbitrary mesh via three-mesh-bvh.
 *
 * Bakes a mesh's signed distance (and gradient normal) into a 3D texture on the
 * CPU, then returns a GPU-side TSL collider function that trilinearly samples it.
 * This lets arbitrary static meshes act as SDF colliders in the WebGPU solver,
 * exactly like the analytic Sphere/Box/Capsule colliders.
 *
 * @module tetrament/colliders/SDFCollider
 */

import * as THREE from 'three';
import { texture3D, vec3, vec4, float, clamp, length, max, normalize, select } from 'three/tsl';
import { MeshCollider } from './MeshCollider.js';

/**
 * Bakes a mesh into a signed-distance 3D texture (RGBA half-float:
 * rgb = outward surface normal, a = signed distance, negative inside).
 *
 * The geometry should already be positioned in the space the collider will act
 * in (i.e. pre-transformed to world space) — the SDF is baked in that frame.
 *
 * @param {THREE.BufferGeometry} geometry - Watertight surface geometry
 * @param {Object} [options]
 * @param {number} [options.resolution=40] - Grid resolution per axis
 * @param {number} [options.padding=0.25] - Padding around the bbox (world units)
 * @returns {{texture: THREE.Data3DTexture, boxMin: THREE.Vector3, boxSize: THREE.Vector3}}
 */
export function bakeSDF(geometry, options = {}) {
    const resolution = options.resolution ?? 40;
    const padding = options.padding ?? 0.25;

    const mesh = new MeshCollider(geometry);

    geometry.computeBoundingBox();
    const bb = geometry.boundingBox.clone();
    const boxMin = bb.min.clone().subScalar(padding);
    const boxMax = bb.max.clone().addScalar(padding);
    const boxSize = boxMax.clone().sub(boxMin);

    const N = resolution;
    const data = new Uint16Array(N * N * N * 4); // half-float RGBA

    const p = new THREE.Vector3();
    const ray = new THREE.Raycaster();
    ray.firstHitOnly = false; // need ALL hits for even/odd parity
    // Count intersections through both faces (a ray exiting the mesh hits backfaces).
    if (mesh.mesh.material) mesh.mesh.material.side = THREE.DoubleSide;
    const dir = new THREE.Vector3(1, 0, 0);
    const closest = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const toHalf = THREE.DataUtils.toHalfFloat;

    // Single-axis parity test for inside/outside (mesh is watertight):
    // an odd number of forward crossings means the point is inside.
    const isInside = (point) => {
        ray.set(point, dir);
        const hits = ray.intersectObject(mesh.mesh, false);
        return (hits.length % 2) === 1;
    };

    let idx = 0;
    for (let k = 0; k < N; k++) {
        const z = boxMin.z + (boxSize.z * (k + 0.5)) / N;
        for (let j = 0; j < N; j++) {
            const y = boxMin.y + (boxSize.y * (j + 0.5)) / N;
            for (let i = 0; i < N; i++) {
                const x = boxMin.x + (boxSize.x * (i + 0.5)) / N;
                p.set(x, y, z);

                const res = mesh.closestPointToPoint(p, closest);
                let dist = res ? p.distanceTo(res.point) : padding;
                normal.subVectors(p, res ? res.point : p);
                if (normal.lengthSq() < 1e-12) normal.set(0, 1, 0);
                normal.normalize();

                if (isInside(p)) {
                    dist = -dist;
                    normal.negate();
                }

                data[idx++] = toHalf(normal.x);
                data[idx++] = toHalf(normal.y);
                data[idx++] = toHalf(normal.z);
                data[idx++] = toHalf(dist);
            }
        }
    }

    mesh.dispose();

    const texture = new THREE.Data3DTexture(data, N, N, N);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.HalfFloatType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;

    return { texture, boxMin, boxSize };
}

/**
 * Creates a GPU SDF collider function from a mesh. The returned function has the
 * standard collider signature `(positionNode) => vec4(normal, signedDistance)`.
 *
 * @param {THREE.BufferGeometry} geometry - Pre-positioned watertight geometry
 * @param {Object} [options] - Baking options (see {@link bakeSDF}) plus:
 * @param {number} [options.margin=0] - Extra distance added to the surface
 * @returns {Function} TSL collider function (pass to simulation.addCollider)
 */
export function SDFCollider(geometry, options = {}) {
    const { texture, boxMin, boxSize } = bakeSDF(geometry, options);
    const margin = options.margin ?? 0;

    const boxMinVec = vec3(boxMin.x, boxMin.y, boxMin.z);
    const boxSizeVec = vec3(boxSize.x, boxSize.y, boxSize.z);
    const tex = texture3D(texture);

    const collider = (position) => {
        // Normalized coordinate in the SDF volume.
        const coord = position.sub(boxMinVec).div(boxSizeVec).toVar();
        const clamped = clamp(coord, 0.0, 1.0);
        const sample = tex.sample(clamped).toVar();

        // Distance outside the padded box (world units), so far points never collide.
        const outside = coord.sub(0.5).abs().sub(0.5).max(vec3(0.0)).mul(boxSizeVec);
        const ext = length(outside);

        const dist = sample.w.add(ext).sub(margin);
        const n = normalize(select(sample.xyz.length().greaterThan(0.01), sample.xyz, vec3(0.0, 1.0, 0.0)));
        return vec4(n, dist);
    };

    collider.texture = texture; // expose for disposal
    return collider;
}
