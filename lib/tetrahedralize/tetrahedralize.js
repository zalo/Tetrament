/**
 * Convenience functions for tetrahedralization
 * @module tetrament/tetrahedralize
 */

import { Tetrahedralizer } from './Tetrahedralizer.js';

/**
 * Tetrahedralizes a THREE.js BufferGeometry
 * @param {THREE.BufferGeometry} geometry - Input surface geometry
 * @param {Object} [options] - Options for tetrahedralization
 * @param {number} [options.resolution=10] - Interior sampling resolution
 * @param {number} [options.minQuality=0.001] - Minimum tet quality
 * @param {boolean} [options.verbose=false] - Enable logging
 * @returns {Object} Result containing tetVerts, tetIds, vertices, tetCount
 */
export function tetrahedralize(geometry, options = {}) {
    const tetrahedralizer = new Tetrahedralizer(options);
    const result = tetrahedralizer.tetrahedralize(geometry);
    tetrahedralizer.dispose();
    return result;
}

/**
 * Tetrahedralizes an array of points
 * @param {THREE.Vector3[]|Float32Array|number[][]} points - Input points
 * @param {Object} [options] - Options for tetrahedralization
 * @param {number} [options.minQuality=0.001] - Minimum tet quality
 * @param {boolean} [options.verbose=false] - Enable logging
 * @returns {Object} Result containing tetVerts, tetIds, vertices, tetCount
 */
export function tetrahedralizePoints(points, options = {}) {
    const tetrahedralizer = new Tetrahedralizer({
        ...options,
        resolution: 0 // No interior sampling for point clouds
    });
    const result = tetrahedralizer.tetrahedralizePoints(points);
    tetrahedralizer.dispose();
    return result;
}
