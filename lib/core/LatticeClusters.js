/**
 * Overlapping shape matching clusters for lattice shape matching
 * (Rivers & James 2007, "FastLSM: Fast Lattice Shape Matching for Robust Real-Time Deformation")
 *
 * Tetrament meshes are arbitrary tet meshes rather than voxel lattices, so the
 * lattice is laid over each object instead: its vertices are binned into cubic
 * blocks in rest space, in two layers offset by half a block. Every vertex ends up
 * in exactly one block of each layer, and the half-block offset makes neighbouring
 * blocks of one layer overlap the blocks of the other, so stiffness carries across
 * block boundaries.
 *
 * @module tetrament/core/LatticeClusters
 */

/**
 * Builds the clusters of one object
 * @param {Array} vertices - The object's vertices (THREE.Vector3 in model space, with .id)
 * @param {Array} tets - The object's tets ({ v0, v1, v2, v3 })
 * @param {number} blockSize - Block edge length in multiples of the mean tet edge length
 * @returns {Array<{layer: number, members: Array<{vertexId: number, mass: number, restOffset: number[]}>}>}
 */
export function buildLatticeClusters(vertices, tets, blockSize) {
    if (vertices.length === 0 || tets.length === 0) return [];

    // Vertex masses (unit density): a quarter of every adjacent tet's volume
    const mass = new Map(vertices.map(v => [v.id, 0]));
    let edgeSum = 0;
    for (const { v0, v1, v2, v3 } of tets) {
        const a = v1.clone().sub(v0);
        const b = v2.clone().sub(v0);
        const c = v3.clone().sub(v0);
        const quarterVolume = Math.abs(a.clone().cross(b).dot(c)) / 24;
        for (const v of [v0, v1, v2, v3]) mass.set(v.id, mass.get(v.id) + quarterVolume);
        edgeSum += a.length() + b.length() + c.length() + v1.distanceTo(v2) + v1.distanceTo(v3) + v2.distanceTo(v3);
    }
    const size = blockSize * edgeSum / (tets.length * 6);

    const min = vertices[0].clone();
    vertices.forEach(v => min.min(v));

    const clusters = [];
    for (let layer = 0; layer < 2; layer++) {
        const offset = layer * size * 0.5;
        const blocks = new Map();
        for (const v of vertices) {
            if (!(mass.get(v.id) > 0)) continue; // orphan vertex
            const key = [v.x, v.y, v.z].map((x, a) => Math.floor((x - min.getComponent(a) + offset) / size)).join(',');
            let block = blocks.get(key);
            if (!block) blocks.set(key, (block = []));
            block.push(v);
        }
        for (const block of blocks.values()) {
            const cluster = _makeCluster(block, mass, layer);
            if (cluster) clusters.push(cluster);
        }
    }
    return clusters;
}

/**
 * Mass-centres a block's rest positions. Returns null for blocks too small or too
 * flat to define a rotation (their vertices simply get no goal from that layer).
 * @private
 */
function _makeCluster(block, mass, layer) {
    if (block.length < 6) return null;

    let total = 0;
    const centroid = [0, 0, 0];
    for (const v of block) {
        const m = mass.get(v.id);
        total += m;
        centroid[0] += v.x * m;
        centroid[1] += v.y * m;
        centroid[2] += v.z * m;
    }
    centroid[0] /= total;
    centroid[1] /= total;
    centroid[2] /= total;

    // Rest inertia sum(m r r^T): reject (nearly) flat or collinear blocks
    const members = [];
    const I = [0, 0, 0, 0, 0, 0]; // xx yy zz xy xz yz
    for (const v of block) {
        const m = mass.get(v.id);
        const r = [v.x - centroid[0], v.y - centroid[1], v.z - centroid[2]];
        I[0] += m * r[0] * r[0]; I[1] += m * r[1] * r[1]; I[2] += m * r[2] * r[2];
        I[3] += m * r[0] * r[1]; I[4] += m * r[0] * r[2]; I[5] += m * r[1] * r[2];
        members.push({ vertexId: v.id, mass: m, restOffset: r });
    }
    const det = I[0] * (I[1] * I[2] - I[5] * I[5]) - I[3] * (I[3] * I[2] - I[5] * I[4]) + I[4] * (I[3] * I[5] - I[1] * I[4]);
    const trace = I[0] + I[1] + I[2];
    if (!(det > 1e-3 * Math.pow(trace / 3, 3))) return null;

    return { layer, members };
}
