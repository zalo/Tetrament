/**
 * Model processing utilities for converting geometries to softbody-ready formats
 * @module tetrament/geometry/ModelProcessor
 */

import * as THREE from 'three';

/**
 * Processes raw tetrahedral data into an indexed format
 * @param {number[]|Float32Array} tetVertsRaw - Flat array of vertex positions
 * @param {number[]|Uint32Array} tetIdsRaw - Flat array of tet indices (1-based)
 * @returns {Object} Processed tet data
 */
export function processTetGeometry(tetVertsRaw, tetIdsRaw) {
    const vertices = [];
    const tets = [];

    const addVertex = (x, y, z) => {
        const id = vertices.length;
        const vertex = new THREE.Vector3(Number(x), Number(y), Number(z));
        vertex.id = id;
        vertex.tetCount = 0;
        vertices.push(vertex);
    };

    const addTet = (v0, v1, v2, v3) => {
        const id = tets.length;
        const center = v0.clone().add(v1).add(v2).add(v3).divideScalar(4);
        const tet = { id, v0, v1, v2, v3, center };
        tets.push(tet);
    };

    // Parse vertices
    for (let i = 0; i < tetVertsRaw.length; i += 3) {
        addVertex(tetVertsRaw[i], tetVertsRaw[i + 1], tetVertsRaw[i + 2]);
    }

    // Parse tets (handle both 0-based and 1-based indexing)
    const isOneBased = tetIdsRaw[0] >= 1 && Math.max(...tetIdsRaw) > vertices.length;
    const offset = isOneBased ? -1 : 0;

    for (let i = 0; i < tetIdsRaw.length; i += 4) {
        const a = vertices[tetIdsRaw[i] + offset];
        const b = vertices[tetIdsRaw[i + 1] + offset];
        const c = vertices[tetIdsRaw[i + 2] + offset];
        const d = vertices[tetIdsRaw[i + 3] + offset];

        if (a && b && c && d) {
            a.tetCount++;
            b.tetCount++;
            c.tetCount++;
            d.tetCount++;
            addTet(a, b, c, d);
        }
    }

    // Filter unused vertices and reindex
    const filteredVertices = vertices.filter(v => v.tetCount > 0);
    filteredVertices.forEach((v, index) => { v.id = index; });

    const tetVerts = filteredVertices.flatMap(v => [v.x, v.y, v.z]);
    const tetIds = tets.flatMap(t => [t.v0.id, t.v1.id, t.v2.id, t.v3.id]);

    return { tetVerts, tetIds, vertices: filteredVertices, tets };
}

/**
 * Processes a surface geometry to find barycentric coordinates within tetrahedra
 * @param {THREE.BufferGeometry} geometry - Surface geometry
 * @param {Array} tets - Array of tetrahedra from processTetGeometry
 * @returns {Object} Surface data with tet attachments
 */
export function processGeometry(geometry, tets) {
    const positionAttribute = geometry.getAttribute('position');
    const normalAttribute = geometry.getAttribute('normal');
    const uvAttribute = geometry.getAttribute('uv');
    const vertexCount = positionAttribute.count;

    const positionArray = positionAttribute.array;
    const normalArray = normalAttribute ? normalAttribute.array : new Float32Array(vertexCount * 3);
    const uvArray = uvAttribute ? uvAttribute.array : new Float32Array(vertexCount * 2);
    const indexArray = geometry.index ? geometry.index.array : null;

    const tetIdArray = new Uint32Array(vertexCount);
    const tetBaryCoordsArray = new Float32Array(vertexCount * 3);

    // Find closest tet for each surface vertex
    const findClosestTet = (vertex) => {
        let minDist = Infinity;
        let closestTet = null;

        for (const tet of tets) {
            const dist = vertex.distanceTo(tet.center);
            if (dist < minDist) {
                minDist = dist;
                closestTet = tet;
            }
        }
        return closestTet;
    };

    // Calculate barycentric matrix inverse for a tet
    const getMatrixInverse = (tet) => {
        const { v0, v1, v2, v3 } = tet;
        const a = v1.clone().sub(v0);
        const b = v2.clone().sub(v0);
        const c = v3.clone().sub(v0);
        const matrix = new THREE.Matrix3().set(
            a.x, b.x, c.x,
            a.y, b.y, c.y,
            a.z, b.z, c.z
        );
        return matrix.clone().invert();
    };

    // Process each vertex
    for (let i = 0; i < vertexCount; i++) {
        const x = positionArray[i * 3];
        const y = positionArray[i * 3 + 1];
        const z = positionArray[i * 3 + 2];
        const vertex = new THREE.Vector3(x, y, z);

        const closestTet = findClosestTet(vertex);
        tetIdArray[i] = closestTet.id;

        const baryCoords = vertex.clone().sub(closestTet.v0).applyMatrix3(getMatrixInverse(closestTet));
        tetBaryCoordsArray[i * 3] = baryCoords.x;
        tetBaryCoordsArray[i * 3 + 1] = baryCoords.y;
        tetBaryCoordsArray[i * 3 + 2] = baryCoords.z;
    }

    // Round values for cleaner output
    const round = v => Math.round(v * 10000) / 10000;

    return {
        attachedTets: Array.from(tetIdArray),
        baryCoords: Array.from(tetBaryCoordsArray).map(round),
        positions: Array.from(positionArray).map(round),
        normals: Array.from(normalArray).map(round),
        uvs: Array.from(uvArray).map(round),
        indices: indexArray ? Array.from(indexArray) : Array.from({ length: vertexCount }, (_, i) => i)
    };
}

/**
 * Parses a .msh file (Gmsh format) and extracts tetrahedral data
 * @param {string} mshContent - Contents of the .msh file
 * @returns {Object} Processed tet data
 */
export function parseMsh(mshContent) {
    const vertexRegex = /\$Nodes\n\d+\n(.+)\$EndNodes/gms;
    const vertexMatch = vertexRegex.exec(mshContent);
    const vertexRepRegex = /\d+\s(.+)\n/gm;
    const tetVertsRaw = vertexMatch[1]
        .replace(vertexRepRegex, '$1 ')
        .trim()
        .split(' ')
        .map(v => Math.round(Number(v) * 10000) / 10000);

    const tetRegex = /\$Elements\n\d+\n(.+)\$EndElements/gms;
    const tetMatch = tetRegex.exec(mshContent);
    const tetRepRegex = /.+(\s\d+\s\d+\s\d+\s\d+)\s\n/gm;
    const tetIdsRaw = tetMatch[1]
        .replace(tetRepRegex, '$1')
        .trim()
        .split(' ')
        .map(v => Number(v));

    return processTetGeometry(tetVertsRaw, tetIdsRaw);
}

/**
 * Loads a complete model from .msh tetrahedral data and surface geometry
 * @param {string} mshContent - Contents of the .msh file
 * @param {THREE.BufferGeometry} surfaceGeometry - Surface geometry for rendering
 * @returns {Object} Complete model ready for softbody simulation
 */
export function loadModelFromMsh(mshContent, surfaceGeometry) {
    const { tetVerts, tetIds, vertices, tets } = parseMsh(mshContent);
    const { attachedTets, baryCoords, normals, uvs, positions, indices } = processGeometry(surfaceGeometry, tets);

    return {
        tetVerts,
        tetIds,
        attachedTets,
        baryCoords,
        normals,
        uvs,
        positions,
        indices
    };
}

/**
 * Loads a model from tetrahedral data and surface geometry
 * @param {Float32Array|number[]} tetVerts - Tetrahedral vertices
 * @param {Uint32Array|number[]} tetIds - Tetrahedral indices
 * @param {THREE.BufferGeometry} surfaceGeometry - Surface geometry for rendering
 * @returns {Object} Complete model ready for softbody simulation
 */
export function loadModelFromGeometry(tetVerts, tetIds, surfaceGeometry) {
    const { vertices, tets } = processTetGeometry(
        Array.from(tetVerts),
        Array.from(tetIds)
    );
    const { attachedTets, baryCoords, normals, uvs, positions, indices } = processGeometry(surfaceGeometry, tets);

    return {
        tetVerts: Array.from(tetVerts),
        tetIds: Array.from(tetIds),
        attachedTets,
        baryCoords,
        normals,
        uvs,
        positions,
        indices
    };
}

/**
 * Generates a complete softbody model by tetrahedralizing a surface geometry
 * @param {THREE.BufferGeometry} geometry - Surface geometry to tetrahedralize
 * @param {Object} [options] - Tetrahedralization options
 * @param {number} [options.resolution=10] - Interior sampling resolution
 * @param {number} [options.minQuality=0.001] - Minimum tet quality
 * @returns {Object} Complete model ready for softbody simulation
 */
export function generateModelFromGeometry(geometry, options = {}) {
    // Import tetrahedralize dynamically to avoid circular dependency
    const { tetrahedralize } = require('../tetrahedralize/tetrahedralize.js');

    const { tetVerts, tetIds, vertices } = tetrahedralize(geometry, options);

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

    const { attachedTets, baryCoords, normals, uvs, positions, indices } = processGeometry(geometry, tets);

    return {
        tetVerts: Array.from(tetVerts),
        tetIds: Array.from(tetIds),
        attachedTets,
        baryCoords,
        normals,
        uvs,
        positions,
        indices
    };
}
