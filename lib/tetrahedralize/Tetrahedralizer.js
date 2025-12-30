/**
 * Tetrahedralizer - Delaunay tetrahedralization using Bowyer-Watson algorithm
 * Ported from BlenderTetPlugin.py by Matthias Mueller (Ten Minute Physics)
 *
 * @module tetrament/tetrahedralize/Tetrahedralizer
 */

import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import {
    getCircumCenter,
    tetQuality,
    randEps,
    compareEdges,
    equalEdges,
    TET_FACES
} from '../utils/math.js';

// Add BVH extensions to THREE.js
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/**
 * Ray cast directions for inside/outside testing
 */
const CAST_DIRECTIONS = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1)
];

/**
 * Tetrahedralizer class for converting surface meshes to tetrahedral meshes
 */
export class Tetrahedralizer {
    /**
     * @param {Object} options - Configuration options
     * @param {number} [options.resolution=10] - Interior sampling resolution (0-100)
     * @param {number} [options.minQuality=0.001] - Minimum tet quality (0-1)
     * @param {boolean} [options.verbose=false] - Enable console logging
     */
    constructor(options = {}) {
        this.resolution = options.resolution ?? 10;
        this.minQuality = options.minQuality ?? 0.001;
        this.verbose = options.verbose ?? false;

        this.bvh = null;
        this.geometry = null;
        this.mesh = null;
    }

    /**
     * Logs a message if verbose mode is enabled
     * @param {...any} args - Arguments to log
     */
    log(...args) {
        if (this.verbose) {
            console.log('[Tetrahedralizer]', ...args);
        }
    }

    /**
     * Tests if a point is inside the mesh using BVH ray casting
     * @param {THREE.Vector3} point - Point to test
     * @param {number} [minDist=0] - Minimum distance from surface
     * @returns {boolean} True if point is inside
     */
    isInside(point, minDist = 0) {
        let numIn = 0;
        const raycaster = new THREE.Raycaster();

        for (const dir of CAST_DIRECTIONS) {
            raycaster.set(point, dir);
            raycaster.firstHitOnly = true;

            const hits = raycaster.intersectObject(this.mesh);
            if (hits.length > 0) {
                const hit = hits[0];
                // Check if normal points same direction as ray (entering surface)
                if (hit.face && hit.face.normal.dot(dir) > 0) {
                    numIn++;
                }
                // If too close to surface, consider outside
                if (minDist > 0 && hit.distance < minDist) {
                    return false;
                }
            }
        }

        return numIn > 3;
    }

    /**
     * Creates tetrahedral connectivity using Bowyer-Watson algorithm
     * @param {THREE.Vector3[]} verts - Array of vertices
     * @returns {number[]} Flat array of tet indices (4 per tet)
     */
    createTetIds(verts) {
        const tetIds = [];
        const neighbors = [];
        const tetMarks = [];
        let tetMark = 0;
        let firstFreeTet = -1;

        const planesN = [];
        const planesD = [];

        const firstBig = verts.length - 4;

        // First big tet (super-tetrahedron)
        tetIds.push(firstBig, firstBig + 1, firstBig + 2, firstBig + 3);
        tetMarks.push(0);

        for (let i = 0; i < 4; i++) {
            neighbors.push(-1);
            const p0 = verts[firstBig + TET_FACES[i][0]];
            const p1 = verts[firstBig + TET_FACES[i][1]];
            const p2 = verts[firstBig + TET_FACES[i][2]];

            const edge1 = new THREE.Vector3().subVectors(p1, p0);
            const edge2 = new THREE.Vector3().subVectors(p2, p0);
            const n = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

            planesN.push(n);
            planesD.push(p0.dot(n));
        }

        const center = new THREE.Vector3();

        this.log('Starting tetrahedralization...');

        // Insert each vertex
        for (let i = 0; i < firstBig; i++) {
            const p = verts[i];

            if (i % 100 === 0) {
                this.log(`Inserting vertex ${i + 1} of ${firstBig}`);
            }

            // Find non-deleted tet
            let tetNr = 0;
            while (tetIds[4 * tetNr] < 0) {
                tetNr++;
            }

            // Find containing tet
            tetMark++;
            let found = false;

            while (!found) {
                if (tetNr < 0 || tetMarks[tetNr] === tetMark) {
                    break;
                }
                tetMarks[tetNr] = tetMark;

                const id0 = tetIds[4 * tetNr];
                const id1 = tetIds[4 * tetNr + 1];
                const id2 = tetIds[4 * tetNr + 2];
                const id3 = tetIds[4 * tetNr + 3];

                center.copy(verts[id0])
                    .add(verts[id1])
                    .add(verts[id2])
                    .add(verts[id3])
                    .multiplyScalar(0.25);

                let minT = Infinity;
                let minFaceNr = -1;

                for (let j = 0; j < 4; j++) {
                    const n = planesN[4 * tetNr + j];
                    const d = planesD[4 * tetNr + j];

                    const hp = n.dot(p) - d;
                    const hc = n.dot(center) - d;

                    const tDenom = hp - hc;
                    if (Math.abs(tDenom) < 1e-10) {
                        continue;
                    }

                    const t = -hc / tDenom;

                    if (t >= 0 && t < minT) {
                        minT = t;
                        minFaceNr = j;
                    }
                }

                if (minT >= 1.0) {
                    found = true;
                } else {
                    tetNr = neighbors[4 * tetNr + minFaceNr];
                }
            }

            if (!found) {
                this.log(`Warning: Failed to insert vertex ${i}`);
                continue;
            }

            // Find violating tets (Delaunay criterion)
            tetMark++;
            const violatingTets = [];
            const stack = [tetNr];

            while (stack.length > 0) {
                tetNr = stack.pop();
                if (tetMarks[tetNr] === tetMark) {
                    continue;
                }
                tetMarks[tetNr] = tetMark;
                violatingTets.push(tetNr);

                for (let j = 0; j < 4; j++) {
                    const n = neighbors[4 * tetNr + j];
                    if (n < 0 || tetMarks[n] === tetMark) {
                        continue;
                    }

                    // Delaunay condition test
                    const id0 = tetIds[4 * n];
                    const id1 = tetIds[4 * n + 1];
                    const id2 = tetIds[4 * n + 2];
                    const id3 = tetIds[4 * n + 3];

                    const c = getCircumCenter(verts[id0], verts[id1], verts[id2], verts[id3]);
                    const r = verts[id0].distanceTo(c);

                    if (p.distanceTo(c) < r) {
                        stack.push(n);
                    }
                }
            }

            // Remove old tets, create new ones
            const edges = [];

            for (const violatingTet of violatingTets) {
                tetNr = violatingTet;

                // Copy info before deletion
                const ids = [
                    tetIds[4 * tetNr],
                    tetIds[4 * tetNr + 1],
                    tetIds[4 * tetNr + 2],
                    tetIds[4 * tetNr + 3]
                ];
                const ns = [
                    neighbors[4 * tetNr],
                    neighbors[4 * tetNr + 1],
                    neighbors[4 * tetNr + 2],
                    neighbors[4 * tetNr + 3]
                ];

                // Mark as deleted
                tetIds[4 * tetNr] = -1;
                tetIds[4 * tetNr + 1] = firstFreeTet;
                firstFreeTet = tetNr;

                // Visit neighbors
                for (let k = 0; k < 4; k++) {
                    const n = ns[k];
                    if (n >= 0 && tetMarks[n] === tetMark) {
                        continue;
                    }

                    // Create new tet facing the border
                    let newTetNr = firstFreeTet;

                    if (newTetNr >= 0) {
                        firstFreeTet = tetIds[4 * firstFreeTet + 1];
                    } else {
                        newTetNr = Math.floor(tetIds.length / 4);
                        tetMarks.push(0);
                        for (let l = 0; l < 4; l++) {
                            tetIds.push(-1);
                            neighbors.push(-1);
                            planesN.push(new THREE.Vector3());
                            planesD.push(0);
                        }
                    }

                    const id0 = ids[TET_FACES[k][2]];
                    const id1 = ids[TET_FACES[k][1]];
                    const id2 = ids[TET_FACES[k][0]];

                    tetIds[4 * newTetNr] = id0;
                    tetIds[4 * newTetNr + 1] = id1;
                    tetIds[4 * newTetNr + 2] = id2;
                    tetIds[4 * newTetNr + 3] = i;

                    neighbors[4 * newTetNr] = n;

                    if (n >= 0) {
                        for (let l = 0; l < 4; l++) {
                            if (neighbors[4 * n + l] === tetNr) {
                                neighbors[4 * n + l] = newTetNr;
                            }
                        }
                    }

                    neighbors[4 * newTetNr + 1] = -1;
                    neighbors[4 * newTetNr + 2] = -1;
                    neighbors[4 * newTetNr + 3] = -1;

                    // Update face planes
                    for (let l = 0; l < 4; l++) {
                        const fp0 = verts[tetIds[4 * newTetNr + TET_FACES[l][0]]];
                        const fp1 = verts[tetIds[4 * newTetNr + TET_FACES[l][1]]];
                        const fp2 = verts[tetIds[4 * newTetNr + TET_FACES[l][2]]];

                        const edge1 = new THREE.Vector3().subVectors(fp1, fp0);
                        const edge2 = new THREE.Vector3().subVectors(fp2, fp0);
                        const newN = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

                        planesN[4 * newTetNr + l] = newN;
                        planesD[4 * newTetNr + l] = newN.dot(fp0);
                    }

                    // Store edges for neighbor fixing
                    if (id0 < id1) {
                        edges.push([id0, id1, newTetNr, 1]);
                    } else {
                        edges.push([id1, id0, newTetNr, 1]);
                    }

                    if (id1 < id2) {
                        edges.push([id1, id2, newTetNr, 2]);
                    } else {
                        edges.push([id2, id1, newTetNr, 2]);
                    }

                    if (id2 < id0) {
                        edges.push([id2, id0, newTetNr, 3]);
                    } else {
                        edges.push([id0, id2, newTetNr, 3]);
                    }
                }
            }

            // Fix neighbors among new tets
            edges.sort(compareEdges);

            let nr = 0;
            const numEdges = edges.length;

            while (nr < numEdges) {
                const e0 = edges[nr];
                nr++;

                if (nr < numEdges && equalEdges(edges[nr], e0)) {
                    const e1 = edges[nr];
                    neighbors[4 * e0[2] + e0[3]] = e1[2];
                    neighbors[4 * e1[2] + e1[3]] = e0[2];
                    nr++;
                }
            }
        }

        // Remove outer, deleted, and outside tets
        const numTets = Math.floor(tetIds.length / 4);
        let num = 0;
        let numBad = 0;

        for (let i = 0; i < numTets; i++) {
            const id0 = tetIds[4 * i];
            const id1 = tetIds[4 * i + 1];
            const id2 = tetIds[4 * i + 2];
            const id3 = tetIds[4 * i + 3];

            // Skip deleted or tets containing super-tet vertices
            if (id0 < 0 || id0 >= firstBig || id1 >= firstBig || id2 >= firstBig || id3 >= firstBig) {
                continue;
            }

            const p0 = verts[id0];
            const p1 = verts[id1];
            const p2 = verts[id2];
            const p3 = verts[id3];

            // Quality check
            const quality = tetQuality(p0, p1, p2, p3);
            if (quality < this.minQuality) {
                numBad++;
                continue;
            }

            // Inside check
            const centroid = new THREE.Vector3()
                .add(p0).add(p1).add(p2).add(p3)
                .multiplyScalar(0.25);

            if (this.bvh && !this.isInside(centroid)) {
                continue;
            }

            // Keep this tet
            tetIds[num++] = id0;
            tetIds[num++] = id1;
            tetIds[num++] = id2;
            tetIds[num++] = id3;
        }

        tetIds.length = num;

        this.log(`${numBad} bad quality tets removed`);
        this.log(`${Math.floor(num / 4)} tets created`);

        return tetIds;
    }

    /**
     * Tetrahedralizes a THREE.js BufferGeometry
     * @param {THREE.BufferGeometry} geometry - Input surface geometry
     * @returns {Object} Result containing tetVerts and tetIds
     */
    tetrahedralize(geometry) {
        // Clone and prepare geometry
        this.geometry = geometry.clone();
        if (!this.geometry.index) {
            this.geometry = this.geometry.toNonIndexed();
        }
        this.geometry.computeVertexNormals();

        // Create BVH for inside/outside testing
        this.geometry.computeBoundsTree();
        this.mesh = new THREE.Mesh(this.geometry);
        this.bvh = this.geometry.boundsTree;

        // Extract surface vertices
        const positionAttr = this.geometry.getAttribute('position');
        const tetVerts = [];
        const vertexMap = new Map();

        // Deduplicate vertices
        for (let i = 0; i < positionAttr.count; i++) {
            const x = positionAttr.getX(i);
            const y = positionAttr.getY(i);
            const z = positionAttr.getZ(i);
            const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;

            if (!vertexMap.has(key)) {
                vertexMap.set(key, tetVerts.length);
                tetVerts.push(new THREE.Vector3(
                    x + randEps(),
                    y + randEps(),
                    z + randEps()
                ));
            }
        }

        this.log(`${tetVerts.length} unique surface vertices`);

        // Compute bounds
        const bbox = new THREE.Box3().setFromBufferAttribute(positionAttr);
        const bmin = bbox.min;
        const bmax = bbox.max;
        const dims = new THREE.Vector3().subVectors(bmax, bmin);

        // Compute center and radius
        const center = new THREE.Vector3().addVectors(bmin, bmax).multiplyScalar(0.5);
        let radius = 0;
        for (const v of tetVerts) {
            radius = Math.max(radius, v.distanceTo(center));
        }

        // Interior sampling
        if (this.resolution > 0) {
            const dim = Math.max(dims.x, dims.y, dims.z);
            const h = dim / this.resolution;

            for (let xi = 0; xi <= Math.floor(dims.x / h); xi++) {
                for (let yi = 0; yi <= Math.floor(dims.y / h); yi++) {
                    for (let zi = 0; zi <= Math.floor(dims.z / h); zi++) {
                        const x = bmin.x + xi * h + randEps();
                        const y = bmin.y + yi * h + randEps();
                        const z = bmin.z + zi * h + randEps();
                        const p = new THREE.Vector3(x, y, z);

                        if (this.isInside(p, 0.5 * h)) {
                            tetVerts.push(p);
                        }
                    }
                }
            }
        }

        this.log(`${tetVerts.length} total vertices (including interior)`);

        // Add super-tetrahedron vertices
        const s = 5.0 * radius;
        tetVerts.push(new THREE.Vector3(-s, 0, -s));
        tetVerts.push(new THREE.Vector3(s, 0, -s));
        tetVerts.push(new THREE.Vector3(0, s, s));
        tetVerts.push(new THREE.Vector3(0, -s, s));

        // Create tetrahedra
        const tetIds = this.createTetIds(tetVerts);

        // Remove super-tet vertices (they were filtered out from tetIds already)
        tetVerts.length -= 4;

        // Convert vertices to flat array
        const tetVertsFlat = new Float32Array(tetVerts.length * 3);
        for (let i = 0; i < tetVerts.length; i++) {
            tetVertsFlat[i * 3] = tetVerts[i].x;
            tetVertsFlat[i * 3 + 1] = tetVerts[i].y;
            tetVertsFlat[i * 3 + 2] = tetVerts[i].z;
        }

        // Clean up
        this.geometry.disposeBoundsTree();

        return {
            tetVerts: tetVertsFlat,
            tetIds: new Uint32Array(tetIds),
            vertices: tetVerts,
            tetCount: Math.floor(tetIds.length / 4)
        };
    }

    /**
     * Tetrahedralizes an array of points (no surface mesh)
     * Useful for creating tetrahedral meshes from point clouds
     * @param {THREE.Vector3[]|Float32Array} points - Input points
     * @returns {Object} Result containing tetVerts and tetIds
     */
    tetrahedralizePoints(points) {
        let tetVerts = [];

        // Convert input to Vector3 array
        if (points instanceof Float32Array) {
            for (let i = 0; i < points.length; i += 3) {
                tetVerts.push(new THREE.Vector3(
                    points[i] + randEps(),
                    points[i + 1] + randEps(),
                    points[i + 2] + randEps()
                ));
            }
        } else if (Array.isArray(points)) {
            for (const p of points) {
                if (p instanceof THREE.Vector3) {
                    tetVerts.push(new THREE.Vector3(
                        p.x + randEps(),
                        p.y + randEps(),
                        p.z + randEps()
                    ));
                } else {
                    tetVerts.push(new THREE.Vector3(
                        p[0] + randEps(),
                        p[1] + randEps(),
                        p[2] + randEps()
                    ));
                }
            }
        }

        // Compute center and radius
        const center = new THREE.Vector3();
        for (const v of tetVerts) {
            center.add(v);
        }
        center.divideScalar(tetVerts.length);

        let radius = 0;
        for (const v of tetVerts) {
            radius = Math.max(radius, v.distanceTo(center));
        }

        // No BVH for point clouds
        this.bvh = null;

        // Add super-tetrahedron
        const s = 5.0 * radius;
        tetVerts.push(new THREE.Vector3(-s, 0, -s));
        tetVerts.push(new THREE.Vector3(s, 0, -s));
        tetVerts.push(new THREE.Vector3(0, s, s));
        tetVerts.push(new THREE.Vector3(0, -s, s));

        // Create tetrahedra
        const tetIds = this.createTetIds(tetVerts);

        // Remove super-tet vertices
        tetVerts.length -= 4;

        // Convert to flat array
        const tetVertsFlat = new Float32Array(tetVerts.length * 3);
        for (let i = 0; i < tetVerts.length; i++) {
            tetVertsFlat[i * 3] = tetVerts[i].x;
            tetVertsFlat[i * 3 + 1] = tetVerts[i].y;
            tetVertsFlat[i * 3 + 2] = tetVerts[i].z;
        }

        return {
            tetVerts: tetVertsFlat,
            tetIds: new Uint32Array(tetIds),
            vertices: tetVerts,
            tetCount: Math.floor(tetIds.length / 4)
        };
    }

    /**
     * Disposes resources
     */
    dispose() {
        if (this.geometry) {
            this.geometry.disposeBoundsTree();
            this.geometry.dispose();
        }
        this.bvh = null;
        this.mesh = null;
    }
}
