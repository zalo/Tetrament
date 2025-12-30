/**
 * Mathematical utilities for tetrahedralization and simulation
 * @module tetrament/utils/math
 */

import * as THREE from 'three';

/**
 * Calculates the circumcenter of a tetrahedron
 * @param {THREE.Vector3} p0 - First vertex
 * @param {THREE.Vector3} p1 - Second vertex
 * @param {THREE.Vector3} p2 - Third vertex
 * @param {THREE.Vector3} p3 - Fourth vertex
 * @returns {THREE.Vector3} Circumcenter position
 */
export function getCircumCenter(p0, p1, p2, p3) {
    const b = new THREE.Vector3().subVectors(p1, p0);
    const c = new THREE.Vector3().subVectors(p2, p0);
    const d = new THREE.Vector3().subVectors(p3, p0);

    const det = 2.0 * (
        b.x * (c.y * d.z - c.z * d.y) -
        b.y * (c.x * d.z - c.z * d.x) +
        b.z * (c.x * d.y - c.y * d.x)
    );

    if (Math.abs(det) < 1e-10) {
        return p0.clone();
    }

    const cd = new THREE.Vector3().crossVectors(c, d).multiplyScalar(b.dot(b));
    const db = new THREE.Vector3().crossVectors(d, b).multiplyScalar(c.dot(c));
    const bc = new THREE.Vector3().crossVectors(b, c).multiplyScalar(d.dot(d));

    const v = cd.add(db).add(bc).divideScalar(det);
    return new THREE.Vector3().addVectors(p0, v);
}

/**
 * Calculates the circumradius of a tetrahedron
 * @param {THREE.Vector3} p0 - First vertex
 * @param {THREE.Vector3} p1 - Second vertex
 * @param {THREE.Vector3} p2 - Third vertex
 * @param {THREE.Vector3} p3 - Fourth vertex
 * @returns {number} Circumradius
 */
export function getCircumRadius(p0, p1, p2, p3) {
    const center = getCircumCenter(p0, p1, p2, p3);
    return p0.distanceTo(center);
}

/**
 * Calculates the quality metric of a tetrahedron
 * Quality of 1.0 indicates a regular tetrahedron
 * @param {THREE.Vector3} p0 - First vertex
 * @param {THREE.Vector3} p1 - Second vertex
 * @param {THREE.Vector3} p2 - Third vertex
 * @param {THREE.Vector3} p3 - Fourth vertex
 * @returns {number} Quality metric (0-1, higher is better)
 */
export function tetQuality(p0, p1, p2, p3) {
    const d0 = new THREE.Vector3().subVectors(p1, p0);
    const d1 = new THREE.Vector3().subVectors(p2, p0);
    const d2 = new THREE.Vector3().subVectors(p3, p0);
    const d3 = new THREE.Vector3().subVectors(p2, p1);
    const d4 = new THREE.Vector3().subVectors(p3, p2);
    const d5 = new THREE.Vector3().subVectors(p1, p3);

    const s0 = d0.length();
    const s1 = d1.length();
    const s2 = d2.length();
    const s3 = d3.length();
    const s4 = d4.length();
    const s5 = d5.length();

    const ms = (s0*s0 + s1*s1 + s2*s2 + s3*s3 + s4*s4 + s5*s5) / 6.0;
    const rms = Math.sqrt(ms);

    const scale = 12.0 / Math.sqrt(2.0);
    const vol = d0.dot(new THREE.Vector3().crossVectors(d1, d2)) / 6.0;

    if (rms < 1e-10) return 0;
    return scale * vol / (rms * rms * rms);
}

/**
 * Calculates the volume of a tetrahedron
 * @param {THREE.Vector3} p0 - First vertex
 * @param {THREE.Vector3} p1 - Second vertex
 * @param {THREE.Vector3} p2 - Third vertex
 * @param {THREE.Vector3} p3 - Fourth vertex
 * @returns {number} Signed volume
 */
export function tetVolume(p0, p1, p2, p3) {
    const a = new THREE.Vector3().subVectors(p1, p0);
    const b = new THREE.Vector3().subVectors(p2, p0);
    const c = new THREE.Vector3().subVectors(p3, p0);
    return a.dot(new THREE.Vector3().crossVectors(b, c)) / 6.0;
}

/**
 * Calculates barycentric coordinates of a point within a tetrahedron
 * @param {THREE.Vector3} point - Point to calculate coordinates for
 * @param {THREE.Vector3} p0 - First vertex
 * @param {THREE.Vector3} p1 - Second vertex
 * @param {THREE.Vector3} p2 - Third vertex
 * @param {THREE.Vector3} p3 - Fourth vertex
 * @returns {{u: number, v: number, w: number, t: number}} Barycentric coordinates
 */
export function getBarycentricCoords(point, p0, p1, p2, p3) {
    const v0 = new THREE.Vector3().subVectors(p1, p0);
    const v1 = new THREE.Vector3().subVectors(p2, p0);
    const v2 = new THREE.Vector3().subVectors(p3, p0);
    const vp = new THREE.Vector3().subVectors(point, p0);

    const matrix = new THREE.Matrix3().set(
        v0.x, v1.x, v2.x,
        v0.y, v1.y, v2.y,
        v0.z, v1.z, v2.z
    );

    const inverse = matrix.clone().invert();
    const coords = vp.clone().applyMatrix3(inverse);

    return {
        u: 1 - coords.x - coords.y - coords.z,
        v: coords.x,
        w: coords.y,
        t: coords.z
    };
}

/**
 * Gets the centroid of a tetrahedron
 * @param {THREE.Vector3} p0 - First vertex
 * @param {THREE.Vector3} p1 - Second vertex
 * @param {THREE.Vector3} p2 - Third vertex
 * @param {THREE.Vector3} p3 - Fourth vertex
 * @returns {THREE.Vector3} Centroid position
 */
export function getTetCentroid(p0, p1, p2, p3) {
    return new THREE.Vector3()
        .add(p0)
        .add(p1)
        .add(p2)
        .add(p3)
        .multiplyScalar(0.25);
}

/**
 * Face indices for a tetrahedron (CCW winding)
 */
export const TET_FACES = [
    [2, 1, 0],
    [0, 1, 3],
    [1, 2, 3],
    [2, 0, 3]
];

/**
 * Edge indices for a tetrahedron
 */
export const TET_EDGES = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 2],
    [1, 3],
    [2, 3]
];

/**
 * Adds small random perturbation to avoid degeneracies
 * @param {number} [eps=0.0001] - Maximum perturbation
 * @returns {number} Random value in range [-eps, eps]
 */
export function randEps(eps = 0.0001) {
    return -eps + 2.0 * Math.random() * eps;
}

/**
 * Compare function for edge sorting
 * @param {Array} e0 - First edge
 * @param {Array} e1 - Second edge
 * @returns {number} Comparison result
 */
export function compareEdges(e0, e1) {
    if (e0[0] < e1[0] || (e0[0] === e1[0] && e0[1] < e1[1])) {
        return -1;
    }
    return 1;
}

/**
 * Check if two edges are equal
 * @param {Array} e0 - First edge
 * @param {Array} e1 - Second edge
 * @returns {boolean} True if edges are equal
 */
export function equalEdges(e0, e1) {
    return e0[0] === e1[0] && e0[1] === e1[1];
}

/**
 * Clamps a value between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation between two values
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated value
 */
export function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Smoothstep interpolation
 * @param {number} edge0 - Lower edge
 * @param {number} edge1 - Upper edge
 * @param {number} x - Value
 * @returns {number} Smoothstepped value
 */
export function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}
