/**
 * Torus and TorusKnot geometry generators for softbody simulation
 * @module tetrament/geometry/TorusGenerator
 */

import * as THREE from 'three';
import { tetrahedralize } from '../tetrahedralize/tetrahedralize.js';
import { processGeometry } from './ModelProcessor.js';

/**
 * Generates a torus tetrahedral mesh
 * @param {number} [radius=0.3] - Main radius (from center to tube center)
 * @param {number} [tube=0.1] - Tube radius
 * @param {Object} [options] - Generation options
 * @param {number} [options.radialSegments=16] - Segments around the tube
 * @param {number} [options.tubularSegments=32] - Segments around the torus
 * @param {number} [options.resolution=8] - Interior resolution for tetrahedralization
 * @param {number} [options.minQuality=0.001] - Minimum tet quality
 * @returns {Object} Complete model ready for softbody simulation
 */
export function generateTorus(radius = 0.3, tube = 0.1, options = {}) {
    const radialSegments = options.radialSegments ?? 16;
    const tubularSegments = options.tubularSegments ?? 32;
    const resolution = options.resolution ?? 8;
    const minQuality = options.minQuality ?? 0.001;

    // Create surface geometry
    const geometry = new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments);
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
    const surfaceData = processGeometry(geometry, tets);

    return {
        tetVerts: Array.from(tetVerts),
        tetIds: Array.from(tetIds),
        ...surfaceData,
        geometry
    };
}

/**
 * Generates a torus knot tetrahedral mesh
 * @param {number} [radius=0.2] - Main radius
 * @param {number} [tube=0.06] - Tube radius
 * @param {Object} [options] - Generation options
 * @param {number} [options.tubularSegments=64] - Tubular segments
 * @param {number} [options.radialSegments=8] - Radial segments
 * @param {number} [options.p=2] - P parameter (winds around axis)
 * @param {number} [options.q=3] - Q parameter (winds through hole)
 * @param {number} [options.resolution=6] - Interior resolution for tetrahedralization
 * @param {number} [options.minQuality=0.001] - Minimum tet quality
 * @returns {Object} Complete model ready for softbody simulation
 */
export function generateTorusKnot(radius = 0.2, tube = 0.06, options = {}) {
    const tubularSegments = options.tubularSegments ?? 64;
    const radialSegments = options.radialSegments ?? 8;
    const p = options.p ?? 2;
    const q = options.q ?? 3;
    const resolution = options.resolution ?? 6;
    const minQuality = options.minQuality ?? 0.001;

    // Create surface geometry
    const geometry = new THREE.TorusKnotGeometry(radius, tube, tubularSegments, radialSegments, p, q);
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
    const surfaceData = processGeometry(geometry, tets);

    return {
        tetVerts: Array.from(tetVerts),
        tetIds: Array.from(tetIds),
        ...surfaceData,
        geometry
    };
}

/**
 * Generates a cylinder tetrahedral mesh
 * @param {number} [radiusTop=0.2] - Top radius
 * @param {number} [radiusBottom=0.2] - Bottom radius
 * @param {number} [height=0.5] - Height
 * @param {Object} [options] - Generation options
 * @param {number} [options.radialSegments=16] - Radial segments
 * @param {number} [options.heightSegments=8] - Height segments
 * @param {number} [options.resolution=6] - Interior resolution
 * @returns {Object} Complete model ready for softbody simulation
 */
export function generateCylinder(radiusTop = 0.2, radiusBottom = 0.2, height = 0.5, options = {}) {
    const radialSegments = options.radialSegments ?? 16;
    const heightSegments = options.heightSegments ?? 8;
    const resolution = options.resolution ?? 6;
    const minQuality = options.minQuality ?? 0.001;

    // Create surface geometry
    const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, heightSegments);
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
 * Generates a cone tetrahedral mesh
 * @param {number} [radius=0.2] - Base radius
 * @param {number} [height=0.5] - Height
 * @param {Object} [options] - Generation options
 * @returns {Object} Complete model ready for softbody simulation
 */
export function generateCone(radius = 0.2, height = 0.5, options = {}) {
    return generateCylinder(0, radius, height, options);
}
