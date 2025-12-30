/**
 * Sphere geometry generator for softbody simulation
 * @module tetrament/geometry/SphereGenerator
 */

import * as THREE from 'three';
import { tetrahedralize } from '../tetrahedralize/tetrahedralize.js';
import { processGeometry, processTetGeometry } from './ModelProcessor.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Generates a sphere tetrahedral mesh
 * @param {number} [radius=1] - Radius of the sphere
 * @param {Object} [options] - Generation options
 * @param {number} [options.widthSegments=16] - Horizontal segments
 * @param {number} [options.heightSegments=12] - Vertical segments
 * @param {number} [options.resolution=8] - Interior resolution for tetrahedralization
 * @param {number} [options.minQuality=0.001] - Minimum tet quality
 * @returns {Object} Complete model ready for softbody simulation
 */
export function generateSphere(radius = 1, options = {}) {
    const widthSegments = options.widthSegments ?? 16;
    const heightSegments = options.heightSegments ?? 12;
    const resolution = options.resolution ?? 8;
    const minQuality = options.minQuality ?? 0.001;

    // Create surface geometry
    let geometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
    //geometry = mergeVertices(geometry, 0.001);
    geometry.computeVertexNormals();

    // Tetrahedralize
    const { tetVerts, tetIds, vertices } = tetrahedralize(geometry, {
        resolution,
        minQuality
    });

    // Create tets array for processGeometry
    const tets = [];
    for (let i = 0; i < tetIds.length; i += 4) {
        const v0 = vertices[tetIds[i]];
        const v1 = vertices[tetIds[i + 1]];
        const v2 = vertices[tetIds[i + 2]];
        const v3 = vertices[tetIds[i + 3]];
        const center = new THREE.Vector3()
            .add(v0).add(v1).add(v2).add(v3)
            .multiplyScalar(0.25);
        tets.push({ id: tets.length, v0, v1, v2, v3, center });
    }

    // Process surface geometry
    const { attachedTets, baryCoords, normals, uvs, positions, indices } = processGeometry(geometry, tets);

    return {
        tetVerts: Array.from(tetVerts),
        tetIds: Array.from(tetIds),
        attachedTets,
        baryCoords,
        normals,
        uvs,
        positions,
        indices,
        geometry
    };
}

/**
 * Generates an icosphere tetrahedral mesh (more uniform distribution)
 * @param {number} [radius=1] - Radius of the sphere
 * @param {Object} [options] - Generation options
 * @param {number} [options.detail=2] - Subdivision level (0-4)
 * @param {number} [options.resolution=8] - Interior resolution
 * @returns {Object} Complete model ready for softbody simulation
 */
export function generateIcosphere(radius = 1, options = {}) {
    const detail = options.detail ?? 2;
    const resolution = options.resolution ?? 8;
    const minQuality = options.minQuality ?? 0.001;

    // Create icosphere surface geometry
    let geometry = new THREE.IcosahedronGeometry(radius, detail);
    geometry = mergeVertices(geometry, 0.001);
    geometry.computeVertexNormals();

    // Add UVs (spherical mapping)
    const positions = geometry.getAttribute('position');
    const uvs = new Float32Array(positions.count * 2);

    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);

        // Spherical UV mapping
        const u = 0.5 + Math.atan2(z, x) / (2 * Math.PI);
        const v = 0.5 - Math.asin(y / radius) / Math.PI;

        uvs[i * 2] = u;
        uvs[i * 2 + 1] = v;
    }

    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    // Tetrahedralize
    const { tetVerts, tetIds, vertices } = tetrahedralize(geometry, {
        resolution,
        minQuality
    });

    // Create tets array
    const tets = [];
    for (let i = 0; i < tetIds.length; i += 4) {
        const v0 = vertices[tetIds[i]];
        const v1 = vertices[tetIds[i + 1]];
        const v2 = vertices[tetIds[i + 2]];
        const v3 = vertices[tetIds[i + 3]];
        const center = new THREE.Vector3()
            .add(v0).add(v1).add(v2).add(v3)
            .multiplyScalar(0.25);
        tets.push({ id: tets.length, v0, v1, v2, v3, center });
    }

    // Process surface geometry
    const surfaceData = processGeometry(geometry, tets);

    return {
        tetVerts: Array.from(tetVerts),
        tetIds: Array.from(tetIds),
        ...surfaceData,
        geometry
    };
}
