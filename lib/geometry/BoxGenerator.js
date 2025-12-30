/**
 * Box geometry generator for softbody simulation
 * @module tetrament/geometry/BoxGenerator
 */

import * as THREE from 'three';
import { tetrahedralize } from '../tetrahedralize/tetrahedralize.js';
import { processGeometry, processTetGeometry } from './ModelProcessor.js';

/**
 * Generates a box tetrahedral mesh
 * @param {number} [width=1] - Width of the box
 * @param {number} [height=1] - Height of the box
 * @param {number} [depth=1] - Depth of the box
 * @param {Object} [options] - Generation options
 * @param {number} [options.widthSegments=4] - Width segments
 * @param {number} [options.heightSegments=4] - Height segments
 * @param {number} [options.depthSegments=4] - Depth segments
 * @param {number} [options.resolution=6] - Interior resolution
 * @returns {Object} Complete model ready for softbody simulation
 */
export function generateBox(width = 1, height = 1, depth = 1, options = {}) {
    const widthSegments = options.widthSegments ?? 4;
    const heightSegments = options.heightSegments ?? 4;
    const depthSegments = options.depthSegments ?? 4;
    const resolution = options.resolution ?? 6;
    const minQuality = options.minQuality ?? 0.001;

    // Create surface geometry
    const geometry = new THREE.BoxGeometry(
        width, height, depth,
        widthSegments, heightSegments, depthSegments
    );
    geometry.computeVertexNormals();

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

/**
 * Generates a simple box with predefined tetrahedralization (5 tets)
 * More efficient for simple box shapes
 * @param {number} [width=1] - Width
 * @param {number} [height=1] - Height
 * @param {number} [depth=1] - Depth
 * @param {Object} [options] - Generation options
 * @returns {Object} Complete model ready for softbody simulation
 */
export function generateSimpleBox(width = 1, height = 1, depth = 1, options = {}) {
    const hw = width / 2;
    const hh = height / 2;
    const hd = depth / 2;

    // 8 corner vertices
    const tetVertsRaw = [
        -hw, -hh, -hd,  // 0
         hw, -hh, -hd,  // 1
         hw,  hh, -hd,  // 2
        -hw,  hh, -hd,  // 3
        -hw, -hh,  hd,  // 4
         hw, -hh,  hd,  // 5
         hw,  hh,  hd,  // 6
        -hw,  hh,  hd   // 7
    ];

    // 5 tetrahedra that fill a cube
    const tetIdsRaw = [
        0, 1, 3, 4,  // bottom-left
        1, 2, 3, 6,  // top-right-front
        1, 4, 5, 6,  // bottom-right
        3, 4, 6, 7,  // top-left-back
        1, 3, 4, 6   // center
    ];

    // Create surface geometry
    const geometry = new THREE.BoxGeometry(width, height, depth);
    geometry.computeVertexNormals();

    // Process tetrahedral data
    const { tetVerts, tetIds, vertices, tets } = processTetGeometry(tetVertsRaw, tetIdsRaw);
    const surfaceData = processGeometry(geometry, tets);

    return {
        tetVerts,
        tetIds,
        ...surfaceData,
        geometry
    };
}
