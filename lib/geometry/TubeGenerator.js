/**
 * Tube/Capsule geometry generator for softbody simulation
 * @module tetrament/geometry/TubeGenerator
 */

import * as THREE from 'three';
import { processTetGeometry, processGeometry } from './ModelProcessor.js';

/**
 * Generates a tube/capsule tetrahedral mesh
 * @param {number} [segments=10] - Number of segments along the length
 * @param {Object} [options] - Generation options
 * @param {number} [options.radius=0.125] - Radius of the tube
 * @param {number} [options.subdivisions=8] - Radial subdivisions for surface mesh
 * @returns {Object} Complete model ready for softbody simulation
 */
export function generateTube(segments = 10, options = {}) {
    const radius = options.radius ?? 0.125;
    const subdivisions = options.subdivisions ?? 8;
    const capsuleRadius = Math.sqrt(4 / Math.PI) * radius;
    const length = radius * segments * 2;

    const tetVertsRaw = [];
    const tetIdsRaw = [];

    const rr = radius;

    // Create grid of vertices along the tube
    for (let x = 0; x <= segments; x++) {
        const px = x * (length / segments) - length * 0.5;
        tetVertsRaw.push(rr, -px, -rr);
        tetVertsRaw.push(rr, -px, rr);
        tetVertsRaw.push(-rr, -px, rr);
        tetVertsRaw.push(-rr, -px, -rr);
    }

    // Add cap vertices
    tetVertsRaw.push(0, (length * 0.5 + capsuleRadius), 0);
    const bottomVert = tetVertsRaw.length / 3;
    tetVertsRaw.push(0, -(length * 0.5 + capsuleRadius), 0);
    const topVert = tetVertsRaw.length / 3;

    // Create tetrahedral connectivity
    for (let x = 0; x < segments; x++) {
        const v = (n) => x * 4 + n;
        tetIdsRaw.push(v(1), v(4), v(8), v(7));
        tetIdsRaw.push(v(1), v(8), v(5), v(7));
        tetIdsRaw.push(v(1), v(5), v(6), v(7));
        tetIdsRaw.push(v(1), v(6), v(2), v(7));
        tetIdsRaw.push(v(1), v(2), v(3), v(7));
        tetIdsRaw.push(v(1), v(3), v(4), v(7));
    }

    // Add cap tetrahedra
    tetIdsRaw.push(bottomVert, 1, 2, 3);
    tetIdsRaw.push(bottomVert, 1, 3, 4);
    tetIdsRaw.push(topVert, segments * 4 + 1, segments * 4 + 2, segments * 4 + 3);
    tetIdsRaw.push(topVert, segments * 4 + 1, segments * 4 + 3, segments * 4 + 4);

    // Create surface geometry
    const geometry = new THREE.CapsuleGeometry(capsuleRadius, length, 4, subdivisions, segments);

    // Process tetrahedral data
    const { tetVerts, tetIds, vertices, tets } = processTetGeometry(tetVertsRaw, tetIdsRaw);
    const { attachedTets, baryCoords, normals, uvs, positions, indices } = processGeometry(geometry, tets);

    // Scale UVs for proper tiling
    for (let i = 1; i < uvs.length; i += 2) {
        uvs[i] = Math.round(uvs[i] * length * 10000) / 10000;
    }

    return {
        tetVerts,
        tetIds,
        attachedTets,
        baryCoords,
        normals,
        uvs,
        positions,
        indices,
        geometry // Include for reference
    };
}

/**
 * Generates a rope-like tetrahedral mesh with more segments
 * @param {number} [length=2] - Length of the rope
 * @param {number} [segmentsPerUnit=10] - Segments per unit length
 * @param {Object} [options] - Generation options
 * @returns {Object} Complete model ready for softbody simulation
 */
export function generateRope(length = 2, segmentsPerUnit = 10, options = {}) {
    const segments = Math.ceil(length * segmentsPerUnit);
    const radius = options.radius ?? 0.05;
    return generateTube(segments, { ...options, radius });
}
