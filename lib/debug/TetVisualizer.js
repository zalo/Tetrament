/**
 * Tetrahedral mesh visualization for debugging
 * @module tetrament/debug/TetVisualizer
 */

import * as THREE from 'three';
import { TET_FACES, TET_EDGES, tetQuality, tetVolume } from '../utils/math.js';
import { rotateByQuat } from '../core/shaderMath.js';

// WebGPU imports for dynamic visualization
let webgpuImports = null;
async function getWebGPUImports() {
    if (!webgpuImports) {
        const tsl = await import('three/tsl');
        webgpuImports = {
            Fn: tsl.Fn,
            attribute: tsl.attribute,
            vec3: tsl.vec3,
            float: tsl.float,
            transformNormalToView: tsl.transformNormalToView,
            varying: tsl.varying
        };
    }
    return webgpuImports;
}

/**
 * Visualizes tetrahedral mesh structure
 */
export class TetVisualizer {
    /**
     * @param {Object} [options] - Options
     * @param {THREE.Color} [options.wireframeColor] - Wireframe color
     * @param {THREE.Color} [options.faceColor] - Face color
     * @param {number} [options.opacity=1.0] - Face opacity
     * @param {number} [options.scale=0.8] - Tet scale for visualization
     */
    constructor(options = {}) {
        this.wireframeColor = options.wireframeColor ?? new THREE.Color(0x00ff00);
        this.faceColor = options.faceColor ?? new THREE.Color(0x0088ff);
        this.opacity = options.opacity ?? 1.0;
        this.scale = options.scale ?? 0.8;

        this.group = new THREE.Group();
        this.wireframeMesh = null;
        this.faceMesh = null;
    }

    /**
     * Creates visualization from tetrahedral data
     * @param {Float32Array|number[]} tetVerts - Flat array of vertex positions
     * @param {Uint32Array|number[]} tetIds - Flat array of tet indices
     * @param {Object} [options] - Display options
     * @param {boolean} [options.showWireframe=true] - Show wireframe
     * @param {boolean} [options.showFaces=true] - Show faces
     * @param {boolean} [options.colorByQuality=false] - Color by tet quality
     * @returns {THREE.Group} Visualization group
     */
    createVisualization(tetVerts, tetIds, options = {}) {
        const showWireframe = options.showWireframe ?? true;
        const showFaces = options.showFaces ?? true;
        const colorByQuality = options.colorByQuality ?? false;

        // Parse vertices
        const vertices = [];
        for (let i = 0; i < tetVerts.length; i += 3) {
            vertices.push(new THREE.Vector3(tetVerts[i], tetVerts[i + 1], tetVerts[i + 2]));
        }

        // Parse tets
        const tets = [];
        for (let i = 0; i < tetIds.length; i += 4) {
            tets.push([tetIds[i], tetIds[i + 1], tetIds[i + 2], tetIds[i + 3]]);
        }

        // Create geometries
        if (showFaces) {
            this._createFaces(vertices, tets, colorByQuality);
        }

        if (showWireframe) {
            this._createWireframe(vertices, tets);
        }

        return this.group;
    }

    /**
     * Creates face geometry
     */
    _createFaces(vertices, tets, colorByQuality) {
        const positions = [];
        const colors = [];

        for (const tet of tets) {
            const v = tet.map(i => vertices[i]);
            const center = new THREE.Vector3()
                .add(v[0]).add(v[1]).add(v[2]).add(v[3])
                .multiplyScalar(0.25);

            // Scale vertices toward center
            const scaled = v.map(vertex =>
                new THREE.Vector3().lerpVectors(center, vertex, this.scale)
            );

            // Calculate quality for coloring
            let color = new THREE.Color(this.faceColor);
            if (colorByQuality) {
                const quality = Math.abs(tetQuality(v[0], v[1], v[2], v[3]));
                // Map quality to color (red = bad, green = good)
                // Clamp quality to [0, 1] range for HSL
                const clampedQuality = Math.min(1, Math.max(0, quality));
                color = new THREE.Color().setHSL(clampedQuality * 0.33, 1, 0.5);
            }

            // Add triangles for each face
            for (const face of TET_FACES) {
                const p0 = scaled[face[0]];
                const p1 = scaled[face[1]];
                const p2 = scaled[face[2]];

                positions.push(p0.x, p0.y, p0.z);
                positions.push(p1.x, p1.y, p1.z);
                positions.push(p2.x, p2.y, p2.z);

                colors.push(color.r, color.g, color.b);
                colors.push(color.r, color.g, color.b);
                colors.push(color.r, color.g, color.b);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            transparent: this.opacity != 1.0,
            opacity: this.opacity,
            side: THREE.DoubleSide,
            depthWrite: this.opacity == 1.0
        });

        this.faceMesh = new THREE.Mesh(geometry, material);
        this.group.add(this.faceMesh);
    }

    /**
     * Creates wireframe geometry
     */
    _createWireframe(vertices, tets) {
        const positions = [];

        for (const tet of tets) {
            const v = tet.map(i => vertices[i]);
            const center = new THREE.Vector3()
                .add(v[0]).add(v[1]).add(v[2]).add(v[3])
                .multiplyScalar(0.25);

            // Scale vertices toward center
            const scaled = v.map(vertex =>
                new THREE.Vector3().lerpVectors(center, vertex, this.scale)
            );

            // Add edges
            for (const edge of TET_EDGES) {
                const p0 = scaled[edge[0]];
                const p1 = scaled[edge[1]];
                positions.push(p0.x, p0.y, p0.z);
                positions.push(p1.x, p1.y, p1.z);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

        const material = new THREE.LineBasicMaterial({
            color: this.wireframeColor,
            transparent: true,
            opacity: 0.8
        });

        this.wireframeMesh = new THREE.LineSegments(geometry, material);
        this.group.add(this.wireframeMesh);
    }

    /**
     * Creates visualization showing only the surface tetrahedra
     * @param {Float32Array|number[]} tetVerts - Vertex positions
     * @param {Uint32Array|number[]} tetIds - Tet indices
     * @param {Object} [options] - Options
     * @returns {THREE.Group} Visualization group
     */
    createSurfaceVisualization(tetVerts, tetIds, options = {}) {
        // Find boundary faces (faces that only appear once)
        const faceMap = new Map();

        const vertices = [];
        for (let i = 0; i < tetVerts.length; i += 3) {
            vertices.push(new THREE.Vector3(tetVerts[i], tetVerts[i + 1], tetVerts[i + 2]));
        }

        for (let i = 0; i < tetIds.length; i += 4) {
            const tet = [tetIds[i], tetIds[i + 1], tetIds[i + 2], tetIds[i + 3]];

            for (const face of TET_FACES) {
                const faceVerts = [tet[face[0]], tet[face[1]], tet[face[2]]].sort((a, b) => a - b);
                const key = faceVerts.join(',');

                if (faceMap.has(key)) {
                    faceMap.delete(key); // Interior face
                } else {
                    faceMap.set(key, faceVerts);
                }
            }
        }

        // Create geometry from boundary faces
        const positions = [];
        const normals = [];

        for (const faceVerts of faceMap.values()) {
            const v0 = vertices[faceVerts[0]];
            const v1 = vertices[faceVerts[1]];
            const v2 = vertices[faceVerts[2]];

            const normal = new THREE.Vector3()
                .subVectors(v1, v0)
                .cross(new THREE.Vector3().subVectors(v2, v0))
                .normalize();

            positions.push(v0.x, v0.y, v0.z);
            positions.push(v1.x, v1.y, v1.z);
            positions.push(v2.x, v2.y, v2.z);

            normals.push(normal.x, normal.y, normal.z);
            normals.push(normal.x, normal.y, normal.z);
            normals.push(normal.x, normal.y, normal.z);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

        const material = new THREE.MeshPhongMaterial({
            color: this.faceColor,
            transparent: true,
            opacity: this.opacity,
            side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geometry, material);
        this.group.add(mesh);

        return this.group;
    }

    /**
     * Gets statistics about the tetrahedral mesh
     * @param {Float32Array|number[]} tetVerts - Vertex positions
     * @param {Uint32Array|number[]} tetIds - Tet indices
     * @returns {Object} Statistics
     */
    static getStatistics(tetVerts, tetIds) {
        const vertices = [];
        for (let i = 0; i < tetVerts.length; i += 3) {
            vertices.push(new THREE.Vector3(tetVerts[i], tetVerts[i + 1], tetVerts[i + 2]));
        }

        const tetCount = tetIds.length / 4;
        let totalVolume = 0;
        let minQuality = Infinity;
        let maxQuality = -Infinity;
        let avgQuality = 0;

        for (let i = 0; i < tetIds.length; i += 4) {
            const v0 = vertices[tetIds[i]];
            const v1 = vertices[tetIds[i + 1]];
            const v2 = vertices[tetIds[i + 2]];
            const v3 = vertices[tetIds[i + 3]];

            totalVolume += Math.abs(tetVolume(v0, v1, v2, v3));
            const quality = Math.abs(tetQuality(v0, v1, v2, v3));
            minQuality = Math.min(minQuality, quality);
            maxQuality = Math.max(maxQuality, quality);
            avgQuality += quality;
        }

        avgQuality /= tetCount;

        return {
            vertexCount: vertices.length,
            tetCount,
            totalVolume,
            minQuality,
            maxQuality,
            avgQuality
        };
    }

    /**
     * Sets visibility
     * @param {boolean} visible
     */
    setVisible(visible) {
        this.group.visible = visible;
    }

    /**
     * Sets wireframe visibility
     * @param {boolean} visible
     */
    setWireframeVisible(visible) {
        if (this.wireframeMesh) {
            this.wireframeMesh.visible = visible;
        }
    }

    /**
     * Sets face visibility
     * @param {boolean} visible
     */
    setFacesVisible(visible) {
        if (this.faceMesh) {
            this.faceMesh.visible = visible;
        }
    }

    /**
     * Disposes resources
     */
    dispose() {
        if (this.wireframeMesh) {
            this.wireframeMesh.geometry.dispose();
            this.wireframeMesh.material.dispose();
        }
        if (this.faceMesh) {
            this.faceMesh.geometry.dispose();
            this.faceMesh.material.dispose();
        }
        this.group.clear();
    }
}

/**
 * Dynamic tetrahedral visualizer that follows the simulation
 * Uses TSL to read deformed positions from GPU buffers
 */
export class DynamicTetVisualizer {
    /**
     * @param {SoftbodySimulation} simulation - Physics simulation
     * @param {Object} [options] - Options
     * @param {THREE.Color} [options.color] - Face color
     * @param {number} [options.scale=0.85] - Tet scale (shrinks toward centroid)
     */
    constructor(simulation, options = {}) {
        this.simulation = simulation;
        this.color = options.color ?? new THREE.Color(0x00ff00);
        this.scale = options.scale ?? 0.85;

        this.enabled = false;
        this._meshes = [];
    }

    /**
     * Creates dynamic tet visualization for a geometry
     * @param {SoftbodyGeometry} geometry - Geometry to visualize
     * @returns {THREE.Mesh} Solid tet mesh
     */
    async createVisualization(geometry) {
        const { Fn, attribute, vec3, float, transformNormalToView, varying } = await getWebGPUImports();
        const { vertexBuffer, tetBuffer } = this.simulation.buffers;
        const { tetIds, tetVerts } = geometry.model;

        const tetCount = tetIds.length / 4;
        const instanceCount = geometry.instances.length;

        // 4 faces per tet, 3 vertices per face = 12 vertices per tet
        const verticesPerTet = 12;
        const totalVertices = tetCount * verticesPerTet;

        const positions = new Float32Array(totalVertices * 3);
        const normals = new Float32Array(totalVertices * 3);
        const colors = new Float32Array(totalVertices * 3);
        const tetIdArray = new Uint32Array(totalVertices);
        const vertexIdArray = new Uint32Array(totalVertices * 4);
        const baryArray = new Float32Array(totalVertices * 3);
        const instanceDataArray = new Uint32Array(instanceCount * 3);

        // Fill instance data
        for (let i = 0; i < instanceCount; i++) {
            const instance = geometry.instances[i];
            instanceDataArray[i * 3] = instance.id;
            instanceDataArray[i * 3 + 1] = instance.tetOffset;
            instanceDataArray[i * 3 + 2] = instance.vertexOffset;
        }

        // Tet faces (CCW winding) - indices into tet vertices [0,1,2,3]
        const TET_FACES = [
            [2, 1, 0],
            [0, 1, 3],
            [1, 2, 3],
            [2, 0, 3]
        ];

        // Barycentric coords for each tet vertex
        const barycoords = [
            [1, 0, 0], // v0
            [0, 1, 0], // v1
            [0, 0, 1], // v2
            [0, 0, 0]  // v3
        ];

        // Fill face data
        let vertIdx = 0;
        for (let t = 0; t < tetCount; t++) {
            const tetVertIds = [
                tetIds[t * 4],
                tetIds[t * 4 + 1],
                tetIds[t * 4 + 2],
                tetIds[t * 4 + 3]
            ];

            // Get rest positions for this tet
            const restVerts = tetVertIds.map(vi => new THREE.Vector3(
                tetVerts[vi * 3],
                tetVerts[vi * 3 + 1],
                tetVerts[vi * 3 + 2]
            ));

            // Compute centroid for scaling
            const centroid = new THREE.Vector3()
                .add(restVerts[0])
                .add(restVerts[1])
                .add(restVerts[2])
                .add(restVerts[3])
                .multiplyScalar(0.25);

            // Scale rest vertices toward centroid
            const scaledVerts = restVerts.map(v =>
                new THREE.Vector3().lerpVectors(centroid, v, this.scale)
            );

            // Compute random color based on tet index
            const color = new THREE.Color().setHSL((t * 0.618033988749895) % 1, 0.5, 0.5);

            for (const face of TET_FACES) {
                // Compute rest-pose face normal from scaled vertices
                const p0 = scaledVerts[face[0]];
                const p1 = scaledVerts[face[1]];
                const p2 = scaledVerts[face[2]];
                const edge1 = new THREE.Vector3().subVectors(p1, p0);
                const edge2 = new THREE.Vector3().subVectors(p2, p0);
                //const faceNormal = new THREE.Vector3().crossVectors(edge2, edge1).normalize();

                for (let f = 0; f < 3; f++) {
                    const localIdx = face[f];
                    const vi = tetVertIds[localIdx];

                    // Rest position (will be overridden by shader)
                    positions[vertIdx * 3] = tetVerts[vi * 3];
                    positions[vertIdx * 3 + 1] = tetVerts[vi * 3 + 1];
                    positions[vertIdx * 3 + 2] = tetVerts[vi * 3 + 2];

                    //// Store rest-pose face normal (will be rotated by tet quat in shader)
                    //normals[vertIdx * 3] = faceNormal.x;
                    //normals[vertIdx * 3 + 1] = faceNormal.y;
                    //normals[vertIdx * 3 + 2] = faceNormal.z;

                    colors[vertIdx * 3] = color.r;
                    colors[vertIdx * 3 + 1] = color.g;
                    colors[vertIdx * 3 + 2] = color.b;

                    tetIdArray[vertIdx] = t;
                    vertexIdArray[vertIdx * 4] = tetVertIds[0];
                    vertexIdArray[vertIdx * 4 + 1] = tetVertIds[1];
                    vertexIdArray[vertIdx * 4 + 2] = tetVertIds[2];
                    vertexIdArray[vertIdx * 4 + 3] = tetVertIds[3];

                    baryArray[vertIdx * 3] = barycoords[localIdx][0];
                    baryArray[vertIdx * 3 + 1] = barycoords[localIdx][1];
                    baryArray[vertIdx * 3 + 2] = barycoords[localIdx][2];

                    vertIdx++;
                }
            }
        }

        // Create geometry
        const bufferGeometry = new THREE.InstancedBufferGeometry();
        bufferGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        //bufferGeometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        bufferGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        bufferGeometry.setAttribute('tetId', new THREE.BufferAttribute(tetIdArray, 1));
        bufferGeometry.setAttribute('vertexIds', new THREE.BufferAttribute(vertexIdArray, 4));
        bufferGeometry.setAttribute('tetBaryCoords', new THREE.BufferAttribute(baryArray, 3));
        bufferGeometry.setAttribute('instanceData', new THREE.InstancedBufferAttribute(instanceDataArray, 3));
        bufferGeometry.instanceCount = instanceCount;

        bufferGeometry.computeVertexNormals();

        // Create material with TSL position node
        const THREE_WEBGPU = await import('three/webgpu');
        const material = new THREE_WEBGPU.MeshStandardNodeMaterial({
            //color: this.color,
            vertexColors: true,
            roughness: 0.6,
            metalness: 0.1,
            side: THREE.DoubleSide
        });

        const scale = this.scale;
        const vNormal = varying(attribute('normal'), 'v_tetNormal');

        material.positionNode = Fn(() => {
            const tetOffset = attribute('instanceData').y;
            const vertexOffset = attribute('instanceData').z;
            const tetId = attribute('tetId').add(tetOffset);
            const vertexIds = attribute('vertexIds').add(vertexOffset).toVar();
            const baryCoords = attribute('tetBaryCoords');

            // Get vertex positions from physics buffer
            const v0 = vertexBuffer.get(vertexIds.x, 'position').xyz.toVar();
            const v1 = vertexBuffer.get(vertexIds.y, 'position').xyz.toVar();
            const v2 = vertexBuffer.get(vertexIds.z, 'position').xyz.toVar();
            const v3 = vertexBuffer.get(vertexIds.w, 'position').xyz.toVar();

            // Compute centroid
            const centroid = v0.add(v1).add(v2).add(v3).mul(0.25).toVar();

            // Interpolate position using barycentric coordinates
            const a = v1.sub(v0).mul(baryCoords.x);
            const b = v2.sub(v0).mul(baryCoords.y);
            const c = v3.sub(v0).mul(baryCoords.z);
            const position = a.add(b).add(c).add(v0).toVar();

            // Scale toward centroid
            const scaled = centroid.add(position.sub(centroid).mul(float(scale)));

            //// Get tet quaternion and rotate the rest-pose normal
            //const quat = tetBuffer.get(tetId, 'quat');
            //const rotatedNormal = rotateByQuat(attribute('normal'), quat).negate();
            //vNormal.assign(rotatedNormal);

            return scaled;
        })();

        material.normalNode = transformNormalToView(vNormal);

        const mesh = new THREE_WEBGPU.Mesh(bufferGeometry, material);
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        return mesh;
    }

    /**
     * Enables dynamic tet visualization
     */
    async enable() {
        if (this.enabled) return;
        this.enabled = true;

        // Hide original meshes
        for (const geometry of this.simulation.geometries) {
            if (geometry.mesh) {
                geometry.mesh.visible = false;
            }
        }

        // Create and add tet visualization meshes
        for (const geometry of this.simulation.geometries) {
            const mesh = await this.createVisualization(geometry);
            this._meshes.push(mesh);
            this.simulation.object.add(mesh);
        }
    }

    /**
     * Disables dynamic tet visualization
     */
    disable() {
        if (!this.enabled) return;
        this.enabled = false;

        // Remove tet visualization meshes
        for (const mesh of this._meshes) {
            this.simulation.object.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
        this._meshes = [];

        // Show original meshes
        for (const geometry of this.simulation.geometries) {
            if (geometry.mesh) {
                geometry.mesh.visible = true;
            }
        }
    }

    /**
     * Toggles visualization
     */
    async toggle() {
        if (this.enabled) {
            this.disable();
        } else {
            await this.enable();
        }
    }

    /**
     * Disposes resources
     */
    dispose() {
        this.disable();
    }
}
