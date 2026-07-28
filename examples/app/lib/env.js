// Shared scene-building helpers: lighting, ground, environment, geometry generators.
import * as THREE from 'three/webgpu';
import {
    generateTube,
    generateIcosphere,
    generateBox,
    generateTorus,
    generateTorusKnot,
    generateCylinder,
    generateCone,
    tetrahedralize,
    loadModelFromGeometry,
} from '../../../dist/tetrament.js';

export const BG_COLOR = new THREE.Color(0x0b0d16);

/**
 * Removes orphan tet vertices (present in tetVerts but referenced by no
 * tetrahedron). Some generators leave these behind; in the solver they have no
 * influencers and get stuck at the origin, stretching the mesh. Surface binding
 * references tets (not vertices), so pruning + remapping tetIds is safe.
 */
export function pruneOrphanVerts(model) {
    const tetIds = Array.from(model.tetIds);
    const used = [...new Set(tetIds)].sort((a, b) => a - b);
    if (used.length === model.tetVerts.length / 3) return model; // nothing orphaned
    const remap = new Map();
    const verts = [];
    used.forEach((oldIdx, newIdx) => {
        remap.set(oldIdx, newIdx);
        verts.push(model.tetVerts[oldIdx * 3], model.tetVerts[oldIdx * 3 + 1], model.tetVerts[oldIdx * 3 + 2]);
    });
    return { ...model, tetVerts: verts, tetIds: tetIds.map((i) => remap.get(i)) };
}

/**
 * Turns an arbitrary watertight surface mesh into a softbody model by
 * constrained-Delaunay tetrahedralization (CDT) + barycentric surface binding.
 * This is the path for the "dynamic mesh shapes" — feed any BufferGeometry.
 */
export function cdtModel(geometry, { resolution = 6, minQuality = 0.02 } = {}) {
    // Faceted surface (per-face vertices) for a crisp look + clean tet binding.
    const geo = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const { tetVerts, tetIds } = tetrahedralize(geo, { resolution, minQuality });
    return pruneOrphanVerts(loadModelFromGeometry(tetVerts, tetIds, geo));
}

/** Builds a 5-point extruded star surface geometry, centered and normalized. */
function starGeometry(outer = 0.6, inner = 0.26, depth = 0.34) {
    const shape = new THREE.Shape();
    const points = 5;
    for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 });
    geo.center();
    return geo;
}

/** Softbody model generators keyed by name, with a label + accent color for UI. */
export const SHAPES = {
    tube:      { label: 'Tube',       color: 0x6c8cff, make: () => pruneOrphanVerts(generateTube(28, { radius: 0.11 })) },
    sphere:    { label: 'Icosphere',  color: 0x57e0c8, make: () => pruneOrphanVerts(generateIcosphere(0.5, { resolution: 6, detail: 2 })) },
    box:       { label: 'Box',        color: 0xffb454, make: () => pruneOrphanVerts(generateBox(0.9, 0.9, 0.9, { resolution: 4 })) },
    torus:     { label: 'Torus',      color: 0xff6b9d, make: () => pruneOrphanVerts(generateTorus(0.5, 0.2, { resolution: 5, radialSegments: 12, tubularSegments: 24 })) },
    torusKnot: { label: 'Torus Knot', color: 0xc084fc, make: () => pruneOrphanVerts(generateTorusKnot(0.45, 0.16, { resolution: 4, tubularSegments: 48, radialSegments: 6 })) },
    cylinder:  { label: 'Cylinder',   color: 0x4ade80, make: () => pruneOrphanVerts(generateCylinder(0.4, 0.4, 1.0, { resolution: 5 })) },
    cone:      { label: 'Cone',       color: 0xf87171, make: () => pruneOrphanVerts(generateCone(0.5, 1.0, { resolution: 5 })) },
    // ---- arbitrary meshes via CDT ----
    gem:       { label: 'Gem (CDT)',        color: 0x22d3ee, make: () => cdtModel(new THREE.OctahedronGeometry(0.62, 0), { resolution: 5 }) },
    dodeca:    { label: 'Dodecahedron (CDT)', color: 0xa3e635, make: () => cdtModel(new THREE.DodecahedronGeometry(0.6, 0), { resolution: 5 }) },
    star:      { label: 'Star (CDT)',       color: 0xfbbf24, make: () => cdtModel(starGeometry(), { resolution: 5 }) },
    capsule:   { label: 'Capsule (CDT)',    color: 0xf472b6, make: () => cdtModel(new THREE.CapsuleGeometry(0.3, 0.6, 6, 14), { resolution: 5 }) },
};

/**
 * Static obstacle definitions: an arbitrary mesh (used both as a visible
 * rendered mesh and baked into an SDF collider) placed in the world.
 */
export function makeObstacles() {
    return [
        {
            name: 'knot',
            color: 0x8b5cf6,
            position: new THREE.Vector3(-3.0, 1.2, 0),
            geometry: () => new THREE.TorusKnotGeometry(0.6, 0.22, 90, 14),
        },
        {
            name: 'dodeca',
            color: 0x38bdf8,
            position: new THREE.Vector3(3.1, 1.0, -0.4),
            geometry: () => new THREE.DodecahedronGeometry(1.0, 0),
        },
        {
            name: 'prism',
            color: 0xf59e0b,
            position: new THREE.Vector3(0.2, 0.9, -3.0),
            geometry: () => new THREE.IcosahedronGeometry(1.05, 0),
        },
    ];
}

/** Standard three-point-ish lighting for a dark studio look. */
export function addLighting(scene) {
    const hemi = new THREE.HemisphereLight(0x9fb4ff, 0x1a1d2b, 0.55);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(6, 11, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    key.shadow.camera.left = -12;
    key.shadow.camera.right = 12;
    key.shadow.camera.top = 12;
    key.shadow.camera.bottom = -12;
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.02;
    scene.add(key);

    const rim = new THREE.DirectionalLight(0x57e0c8, 0.8);
    rim.position.set(-7, 4, -6);
    scene.add(rim);

    return { hemi, key, rim };
}

/** Reflective dark floor + subtle grid. Returns the group so scenes can hide it. */
export function addGround(scene, { size = 40, y = 0 } = {}) {
    const group = new THREE.Group();

    const groundMat = new THREE.MeshStandardMaterial({
        color: 0x0e1120,
        roughness: 0.65,
        metalness: 0.15,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = y;
    ground.receiveShadow = true;
    group.add(ground);

    const grid = new THREE.GridHelper(size, size, 0x2b3350, 0x1a2036);
    grid.position.y = y + 0.002;
    grid.material.transparent = true;
    grid.material.opacity = 0.6;
    group.add(grid);

    scene.add(group);
    return group;
}

/** Apply a consistent physical material look to a SoftbodyGeometry. */
export function styleBody(geometry, color) {
    const mat = geometry.material;
    mat.color = new THREE.Color(color);
    mat.roughness = 0.35;
    mat.metalness = 0.12;
    if ('clearcoat' in mat) { mat.clearcoat = 0.4; mat.clearcoatRoughness = 0.3; }
    if ('sheen' in mat) mat.sheen = 0.2;
    return geometry;
}

/** A random-ish spread of positions above the origin for dropping bodies. */
export function scatter(i, count, spread = 2.2, baseHeight = 3.2, step = 0.35) {
    const angle = i * 2.399963; // golden angle
    const r = spread * Math.sqrt((i + 0.5) / count);
    return new THREE.Vector3(
        Math.cos(angle) * r,
        baseHeight + i * step * 0.15,
        Math.sin(angle) * r
    );
}
