/**
 * Main softbody simulation class
 * Simplified interface for FEM-based softbody physics using WebGPU
 *
 * @module tetrament/core/SoftbodySimulation
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    instancedArray,
    instanceIndex,
    float,
    uint,
    vec3,
    vec4,
    cross,
    mul,
    mat3,
    int,
    dot,
    If,
    Loop,
    Break,
    normalize,
    Return,
    uniform,
    select,
    ivec3,
    atomicFunc,
    sqrt,
    length,
    uvec4
} from 'three/tsl';

import { SoftbodyGeometry } from './SoftbodyGeometry.js';
import { StructuredArray } from './StructuredArray.js';
import { Grid } from './Grid.js';
import {
    murmurHash13,
    rotateByQuat,
    quat_conj,
    quat_mult,
    extractRotation
} from './shaderMath.js';
import { TET_EDGES } from '../utils/math.js';

/**
 * Configuration options for the simulation
 * @typedef {Object} SimulationConfig
 * @property {number} [stepsPerSecond=60] - Physics steps per second
 * @property {THREE.Vector3} [gravity] - Gravity vector (default: 0, -10, 0)
 * @property {number} [damping=0.99] - Velocity damping per substep
 * @property {number} [friction=0.3] - Surface friction coefficient (0-1)
 * @property {number} [rotationSteps=2] - Rotation extraction iterations
 * @property {number} [edgeCompliance=100.0] - Edge constraint compliance (higher = softer)
 * @property {number} [volCompliance=0.0] - Volume constraint compliance (higher = more compressible)
 * @property {number} [numSubsteps=10] - Number of constraint solver substeps per physics step
 */

/**
 * Main simulation class for softbody physics
 */
export class SoftbodySimulation {
    /**
     * @param {THREE.WebGPURenderer} renderer - WebGPU renderer
     * @param {SimulationConfig} [config] - Simulation configuration
     */
    constructor(renderer, config = {}) {
        this.renderer = renderer;
        this.config = {
            stepsPerSecond: config.stepsPerSecond ?? 60,
            gravity: config.gravity ?? new THREE.Vector3(0, -10.0, 0),
            damping: config.damping ?? 0.99,
            friction: config.friction ?? 0.5,
            rotationSteps: config.rotationSteps ?? 2,
            edgeCompliance: config.edgeCompliance ?? 100.0,
            volCompliance: config.volCompliance ?? 0.0,
            numSubsteps: config.numSubsteps ?? 10
        };

        // Edge data for XPBD constraints
        this.edges = [];
        this.edgeCount = 0;

        // Scene object for all softbody meshes
        this.object = new THREE.Object3D();

        // Data structures
        this.vertices = [];
        this.tets = [];
        this.geometries = [];
        this.objects = [];
        this.objectData = [];
        this.colliders = [];
        this.anchors = [];

        // Counters
        this.vertexCount = 0;
        this.tetCount = 0;
        this.objectCount = 0;

        // GPU resources
        this.kernels = {};
        this.uniforms = {};
        this.buffers = {};

        // Timing
        this.time = 0;
        this.frameNum = 0;
        this.timeSinceLastStep = 0;

        // State
        this.initialized = false;

        // Drag state
        this.dragActive = false;
        this.dragVertexId = -1;
        this.dragTargetPosition = new THREE.Vector3();
        this.dragStrength = 0.5;
    }

    /**
     * Adds a vertex to the simulation
     * @param {number} objectId - Object ID this vertex belongs to
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number} z - Z coordinate
     * @returns {Object} Vertex object
     */
    addVertex(objectId, x, y, z) {
        const id = this.vertexCount;
        const vertex = new THREE.Vector3(x, y, z);
        vertex.id = id;
        vertex.objectId = objectId;
        vertex.influencers = [];
        this.vertices.push(vertex);

        const objectDataElement = this.objectData[objectId];
        const distance = vertex.length();
        if (distance < objectDataElement.centerVertexDistance) {
            objectDataElement.centerVertexDistance = distance;
            objectDataElement.centerVertex = vertex;
        }

        objectDataElement.vertexCount++;
        this.vertexCount++;
        return vertex;
    }

    /**
     * Adds an edge to the simulation (with deduplication)
     * @param {Object} v0 - First vertex
     * @param {Object} v1 - Second vertex
     * @returns {Object|null} Edge object or null if duplicate
     */
    _addEdge(v0, v1) {
        // Normalize edge order (smaller id first)
        const [vA, vB] = v0.id < v1.id ? [v0, v1] : [v1, v0];

        // Check for duplicate using a simple hash
        const edgeKey = `${vA.id}_${vB.id}`;
        if (!this._edgeSet) {
            this._edgeSet = new Set();
        }
        if (this._edgeSet.has(edgeKey)) {
            return null;
        }
        this._edgeSet.add(edgeKey);

        const id = this.edgeCount;
        const restLength = vA.distanceTo(vB);
        const edge = { id, v0: vA, v1: vB, restLength };
        this.edges.push(edge);
        this.edgeCount++;
        return edge;
    }

    /**
     * Adds a tetrahedron to the simulation
     * @param {number} objectId - Object ID this tet belongs to
     * @param {Object} v0 - First vertex
     * @param {Object} v1 - Second vertex
     * @param {Object} v2 - Third vertex
     * @param {Object} v3 - Fourth vertex
     * @returns {Object} Tet object
     */
    addTet(objectId, v0, v1, v2, v3) {
        const id = this.tetCount;
        const tet = { id, v0, v1, v2, v3, objectId };
        this.tets.push(tet);
        v0.influencers.push(id * 4 + 0);
        v1.influencers.push(id * 4 + 1);
        v2.influencers.push(id * 4 + 2);
        v3.influencers.push(id * 4 + 3);
        this.objectData[objectId].tetCount++;
        this.tetCount++;

        // Add edges for XPBD constraints (6 edges per tet)
        const verts = [v0, v1, v2, v3];
        for (const [i, j] of TET_EDGES) {
            this._addEdge(verts[i], verts[j]);
        }

        return tet;
    }

    /**
     * Creates a new object registration
     * @param {Object} object - The softbody instance
     * @returns {Object} Object data
     */
    _addObject(object) {
        const id = this.objects.length;
        this.objects.push(object);

        const params = {
            id,
            centerVertexDistance: 1e9,
            centerVertex: null,
            tetStart: this.tetCount,
            tetCount: 0,
            vertexStart: this.vertexCount,
            vertexCount: 0,
            position: new THREE.Vector3()
        };

        this.objectData.push(params);
        return params;
    }

    /**
     * Creates a new softbody geometry
     * @param {Object} model - Model data with tetVerts, tetIds, etc.
     * @param {typeof THREE.MeshPhysicalNodeMaterial} [materialClass] - Material class
     * @returns {SoftbodyGeometry} The created geometry
     */
    addGeometry(model, materialClass = THREE.MeshPhysicalNodeMaterial) {
        const geometry = new SoftbodyGeometry(this, model, materialClass);
        this.geometries.push(geometry);
        return geometry;
    }

    /**
     * Creates a new instance of a geometry
     * @param {SoftbodyGeometry} geometry - Geometry to instantiate
     * @returns {Object} Instance object
     */
    addInstance(geometry) {
        return geometry.addInstance();
    }

    /**
     * Adds a collider to the simulation
     * @param {Function} collider - Collider function that returns vec4(normal, distance)
     */
    addCollider(collider) {
        this.colliders.push(collider);
    }

    /**
     * Adds an anchor constraint
     * @param {Object} anchor - Anchor configuration
     */
    addAnchor(anchor) {
        this.anchors.push(anchor);
    }

    /**
     * Gets the position of an object
     * @param {number} objectId - Object ID
     * @returns {THREE.Vector3} Position
     */
    getPosition(objectId) {
        return this.objectData[objectId].position;
    }

    /**
     * Initializes GPU resources and compiles compute shaders
     * Must be called before simulation can run
     */
    async bake() {
        // Guard against empty simulation - WebGPU compute shaders fail with 0 dispatch size
        if (this.vertexCount === 0 || this.tetCount === 0) {
            console.warn('[SoftbodySimulation] Cannot bake with 0 vertices/tetrahedrons. Add instances with addInstance() before calling bake().');
            return;
        }

        // Save spawned object info before rebake so we can respawn them
        const spawnedObjectInfo = [];
        if (this.initialized) {
            for (const obj of this.objects) {
                if (obj.spawned && obj.spawnParams) {
                    spawnedObjectInfo.push({
                        instance: obj,
                        params: obj.spawnParams
                    });
                }
            }
        }

        console.log(`[SoftbodySimulation] ${this.vertexCount} vertices, ${this.tetCount} tetrahedrons`);

        // Create tet buffer
        const tetStruct = {
            restVolume: 'float',
            radius: 'float',
            objectId: 'uint',
            nextTet: 'int',
            quat: 'vec4',
            initialPosition: 'vec3',
            centroid: 'vec3',
            vertexIds: 'uvec4'
        };
        const tetBuffer = new StructuredArray(tetStruct, this.tetCount, 'tets');
        this.buffers.tetBuffer = tetBuffer;

        // Create rest poses buffer
        const restposeStruct = {
            position: 'vec3',
            restVolume: 'float'
        };
        const restPosesBuffer = new StructuredArray(restposeStruct, this.tetCount * 4, 'restPoses');
        this.buffers.restPosesBuffer = restPosesBuffer;

        // Fill tet data and store volumes for invMass calculation
        let maxRadius = 0;
        const tetVolumes = new Float32Array(this.tetCount);

        this.tets.forEach((tet, index) => {
            const { v0, v1, v2, v3 } = tet;
            const center = v0.clone().add(v1).add(v2).add(v3).multiplyScalar(0.25);
            const a = v1.clone().sub(v0);
            const b = v2.clone().sub(v0);
            const c = v3.clone().sub(v0);
            const V = Math.abs(a.cross(b).dot(c)) / 6;
            const radius = Math.pow((3 / 4) * V / Math.PI, 1 / 3);
            maxRadius = Math.max(maxRadius, radius);
            tetVolumes[index] = V;

            [v0, v1, v2, v3].forEach((vertex, subindex) => {
                restPosesBuffer.set(index * 4 + subindex, 'position', vertex);
                restPosesBuffer.set(index * 4 + subindex, 'restVolume', V);
            });

            tetBuffer.set(index, 'initialPosition', center);
            tetBuffer.set(index, 'vertexIds', [v0.id, v1.id, v2.id, v3.id]);
            tetBuffer.set(index, 'restVolume', V);
            tetBuffer.set(index, 'quat', [0, 0, 0, 1]);
            tetBuffer.set(index, 'objectId', tet.objectId);
            tetBuffer.set(index, 'radius', radius);
        });

        // Create vertex buffer with inverse mass for XPBD
        const vertexStruct = {
            objectId: 'uint',
            influencerPtr: 'uint',
            influencerCount: 'uint',
            invMass: 'float',
            initialPosition: 'vec3',
            position: 'vec3',
            prevPosition: 'vec3'
        };
        const vertexBuffer = new StructuredArray(vertexStruct, this.vertexCount, 'vertices');
        this.buffers.vertexBuffer = vertexBuffer;

        // Compute inverse mass per vertex (based on volume of adjacent tets)
        const invMassArray = new Float32Array(this.vertexCount).fill(0);
        this.tets.forEach((tet, index) => {
            const { v0, v1, v2, v3 } = tet;
            const vol = tetVolumes[index]; // Use stored volume, not TSL node
            const pInvMass = vol > 0 ? 1.0 / (vol / 4.0) : 0.0;
            invMassArray[v0.id] += pInvMass;
            invMassArray[v1.id] += pInvMass;
            invMassArray[v2.id] += pInvMass;
            invMassArray[v3.id] += pInvMass;
        });

        // Fill vertex data
        const influencerArray = new Uint32Array(this.tetCount * 4);
        let influencerPtr = 0;
        this.vertices.forEach((vertex, index) => {
            vertexBuffer.set(index, 'initialPosition', vertex);
            vertexBuffer.set(index, 'position', vertex);  // Initialize current position
            vertexBuffer.set(index, 'prevPosition', vertex);
            vertexBuffer.set(index, 'influencerPtr', influencerPtr);
            vertexBuffer.set(index, 'influencerCount', vertex.influencers.length);
            vertexBuffer.set(index, 'objectId', vertex.objectId);
            vertexBuffer.set(index, 'invMass', invMassArray[index]);

            vertex.influencers.forEach(influencer => {
                influencerArray[influencerPtr] = influencer;
                influencerPtr++;
            });
        });

        // Create edge buffer for XPBD edge constraints
        console.log(`[SoftbodySimulation] ${this.edgeCount} edges`);
        const edgeStruct = {
            vertexIds: 'uvec2',
            restLength: 'float'
        };
        const edgeBuffer = new StructuredArray(edgeStruct, this.edgeCount, 'edges');
        this.buffers.edgeBuffer = edgeBuffer;

        this.edges.forEach((edge, index) => {
            edgeBuffer.set(index, 'vertexIds', [edge.v0.id, edge.v1.id]);
            edgeBuffer.set(index, 'restLength', edge.restLength);
        });

        // Create object buffer
        const objectStruct = {
            size: 'float',
            centerVertex: 'uint'
        };
        const objectBuffer = new StructuredArray(objectStruct, this.objects.length, 'objects');
        this.buffers.objectBuffer = objectBuffer;

        this.objectData.forEach((objectData, index) => {
            objectBuffer.set(index, 'size', 0.0);
            objectBuffer.set(index, 'centerVertex', objectData.centerVertex.id);
        });

        this.buffers.influencerBuffer = instancedArray(influencerArray, 'uint');

        // Create spatial grid
        const gridCellSize = maxRadius * 2;
        this.grid = new Grid(gridCellSize, 'basic');

        // Create uniforms
        this.uniforms.vertexCount = uniform(this.vertexCount, 'int');
        this.uniforms.tetCount = uniform(this.tetCount, 'int');
        this.uniforms.edgeCount = uniform(this.edgeCount, 'int');
        this.uniforms.time = uniform(0, 'float');
        this.uniforms.dt = uniform(1, 'float');
        this.uniforms.sdt = uniform(1, 'float'); // substep dt for XPBD
        this.uniforms.gravity = uniform(this.config.gravity, 'vec3');
        this.uniforms.damping = uniform(this.config.damping, 'float');
        this.uniforms.friction = uniform(this.config.friction, 'float');
        this.uniforms.rotationRefinementSteps = uniform(this.config.rotationSteps, 'int');
        this.uniforms.edgeCompliance = uniform(this.config.edgeCompliance, 'float');
        this.uniforms.volCompliance = uniform(this.config.volCompliance, 'float');

        // Compile kernels
        await this._compileKernels();

        // Bake geometries
        const geometryPromises = this.geometries.map(geom => geom.bake(this));
        await Promise.all(geometryPromises);

        this.initialized = true;

        // Respawn previously spawned objects to restore their positions
        for (const { instance, params } of spawnedObjectInfo) {
            await this.resetObject(
                instance.id,
                params.position,
                params.quaternion,
                params.scale,
                new THREE.Vector3() // Reset velocity to zero on respawn
            );
        }
    }

    /**
     * Compiles GPU compute shaders using XPBD constraint solver
     */
    async _compileKernels() {
        const { tetBuffer, vertexBuffer, objectBuffer, restPosesBuffer, influencerBuffer, edgeBuffer } = this.buffers;

        // Clear grid
        this.grid.clearBuffer(this.renderer);

        // Kernel 1: Pre-solve - apply gravity, damping, and predict positions
        this.kernels.preSolve = Fn(() => {
            If(instanceIndex.lessThan(this.uniforms.vertexCount), () => {
                const objectId = vertexBuffer.get(instanceIndex, 'objectId');
                const size = objectBuffer.get(objectId, 'size');

                If(size.greaterThanEqual(0.0001), () => {
                    const invMass = vertexBuffer.get(instanceIndex, 'invMass').toVar();

                    If(invMass.greaterThan(0.0), () => {
                        const { sdt, gravity, friction, damping } = this.uniforms;
                        const position = vertexBuffer.get(instanceIndex, 'position').toVar();
                        const prevPosition = vertexBuffer.get(instanceIndex, 'prevPosition').toVar();

                        // Calculate velocity, apply damping and gravity
                        const vel = position.sub(prevPosition).mul(damping).toVar();
                        vel.addAssign(gravity.mul(sdt.mul(sdt)));

                        // Store current position as previous
                        vertexBuffer.get(instanceIndex, 'prevPosition').assign(position);

                        // Predict new position
                        position.addAssign(vel);

                        // Apply colliders (floor collision with friction)
                        this.colliders.forEach((collider) => {
                            const colliderResult = collider(position);
                            const penetration = colliderResult.w.min(0).negate().toVar();
                            const normal = colliderResult.xyz;

                            If(penetration.greaterThan(0), () => {
                                // Push out of collision
                                position.addAssign(penetration.mul(normal));

                                // Apply friction by reducing tangential velocity
                                const currentVel = position.sub(prevPosition).toVar();
                                const normalVel = dot(currentVel, normal).toVar();
                                const tangentVel = currentVel.sub(normal.mul(normalVel)).toVar();
                                const newVel = tangentVel.mul(float(1).sub(friction)).toVar();
                                prevPosition.assign(position.sub(newVel));
                                vertexBuffer.get(instanceIndex, 'prevPosition').assign(prevPosition);
                            });
                        });

                        vertexBuffer.get(instanceIndex, 'position').assign(position);
                    });
                });
            });
        })().compute(this.vertexCount);

        this.renderer.compute(this.kernels.preSolve);

        // Kernel 2: Solve edge constraints (XPBD with Jacobi relaxation)
        // Relaxation factor to handle parallel race conditions
        const edgeRelaxation = 0.25;

        this.kernels.solveEdges = Fn(() => {
            If(instanceIndex.lessThan(this.uniforms.edgeCount), () => {
                const vertexIds = edgeBuffer.get(instanceIndex, 'vertexIds').toVar();
                const id0 = vertexIds.x;
                const id1 = vertexIds.y;

                // Check if both vertices belong to active objects
                const objectId0 = vertexBuffer.get(id0, 'objectId');
                const objectId1 = vertexBuffer.get(id1, 'objectId');
                const size0 = objectBuffer.get(objectId0, 'size');
                const size1 = objectBuffer.get(objectId1, 'size');

                If(size0.greaterThanEqual(0.0001).and(size1.greaterThanEqual(0.0001)), () => {
                    const w0 = vertexBuffer.get(id0, 'invMass').toVar();
                    const w1 = vertexBuffer.get(id1, 'invMass').toVar();
                    const w = w0.add(w1).toVar();

                    If(w.greaterThan(0.0), () => {
                        const { sdt, edgeCompliance } = this.uniforms;
                        const alpha = edgeCompliance.div(sdt.mul(sdt)).toVar();

                        const pos0 = vertexBuffer.get(id0, 'position').toVar();
                        const pos1 = vertexBuffer.get(id1, 'position').toVar();

                        // Gradient: direction from pos1 to pos0
                        const grad = pos0.sub(pos1).toVar();
                        const len = length(grad).toVar();

                        If(len.greaterThan(0.0001), () => {
                            grad.divAssign(len);

                            const restLen = edgeBuffer.get(instanceIndex, 'restLength');
                            const C = len.sub(restLen).toVar();
                            const s = C.negate().div(w.add(alpha)).mul(edgeRelaxation).toVar();

                            // Apply corrections with relaxation
                            vertexBuffer.get(id0, 'position').addAssign(grad.mul(s.mul(w0)));
                            vertexBuffer.get(id1, 'position').subAssign(grad.mul(s.mul(w1)));
                        });
                    });
                });
            });
        })().compute(this.edgeCount);

        this.renderer.compute(this.kernels.solveEdges);

        // Kernel 3: Solve volume constraints (XPBD with Jacobi relaxation)
        // Volume gradient order: for vertex j, use cross product of edges from opposite vertices
        // volIdOrder = [[1,3,2], [0,2,3], [0,3,1], [0,1,2]]
        const volRelaxation = 0.25;

        this.kernels.solveVolumes = Fn(() => {
            If(instanceIndex.lessThan(this.uniforms.tetCount), () => {
                const objectId = tetBuffer.get(instanceIndex, 'objectId');
                const size = objectBuffer.get(objectId, 'size');

                If(size.greaterThanEqual(0.0001), () => {
                    const vertexIds = tetBuffer.get(instanceIndex, 'vertexIds').toVar();
                    const id0 = vertexIds.x;
                    const id1 = vertexIds.y;
                    const id2 = vertexIds.z;
                    const id3 = vertexIds.w;

                    const pos0 = vertexBuffer.get(id0, 'position').toVar();
                    const pos1 = vertexBuffer.get(id1, 'position').toVar();
                    const pos2 = vertexBuffer.get(id2, 'position').toVar();
                    const pos3 = vertexBuffer.get(id3, 'position').toVar();

                    const w0 = vertexBuffer.get(id0, 'invMass').toVar();
                    const w1 = vertexBuffer.get(id1, 'invMass').toVar();
                    const w2 = vertexBuffer.get(id2, 'invMass').toVar();
                    const w3 = vertexBuffer.get(id3, 'invMass').toVar();

                    // Compute gradients: grad_j = (1/6) * cross(edge from volIdOrder[j][0] to [1], edge from [0] to [2])
                    // volIdOrder[0] = [1,3,2]: grad0 = cross(pos3-pos1, pos2-pos1) / 6
                    // volIdOrder[1] = [0,2,3]: grad1 = cross(pos2-pos0, pos3-pos0) / 6
                    // volIdOrder[2] = [0,3,1]: grad2 = cross(pos3-pos0, pos1-pos0) / 6
                    // volIdOrder[3] = [0,1,2]: grad3 = cross(pos1-pos0, pos2-pos0) / 6
                    const grad0 = cross(pos3.sub(pos1), pos2.sub(pos1)).mul(1.0 / 6.0).toVar();
                    const grad1 = cross(pos2.sub(pos0), pos3.sub(pos0)).mul(1.0 / 6.0).toVar();
                    const grad2 = cross(pos3.sub(pos0), pos1.sub(pos0)).mul(1.0 / 6.0).toVar();
                    const grad3 = cross(pos1.sub(pos0), pos2.sub(pos0)).mul(1.0 / 6.0).toVar();

                    // Compute weighted sum of squared gradients
                    const wSum = w0.mul(dot(grad0, grad0))
                        .add(w1.mul(dot(grad1, grad1)))
                        .add(w2.mul(dot(grad2, grad2)))
                        .add(w3.mul(dot(grad3, grad3))).toVar();

                    If(wSum.greaterThan(0.0), () => {
                        const { sdt, volCompliance } = this.uniforms;
                        const alpha = volCompliance.div(sdt.mul(sdt)).toVar();

                        // Compute current volume: V = dot(cross(pos1-pos0, pos2-pos0), pos3-pos0) / 6
                        const e1 = pos1.sub(pos0).toVar();
                        const e2 = pos2.sub(pos0).toVar();
                        const e3 = pos3.sub(pos0).toVar();
                        const vol = dot(cross(e1, e2), e3).div(6.0).toVar();

                        const restVol = tetBuffer.get(instanceIndex, 'restVolume');
                        const C = vol.sub(restVol).toVar();
                        const s = C.negate().div(wSum.add(alpha)).mul(volRelaxation).toVar();

                        // Apply corrections with relaxation
                        vertexBuffer.get(id0, 'position').addAssign(grad0.mul(s.mul(w0)));
                        vertexBuffer.get(id1, 'position').addAssign(grad1.mul(s.mul(w1)));
                        vertexBuffer.get(id2, 'position').addAssign(grad2.mul(s.mul(w2)));
                        vertexBuffer.get(id3, 'position').addAssign(grad3.mul(s.mul(w3)));
                    });
                });
            });
        })().compute(this.tetCount);

        this.renderer.compute(this.kernels.solveVolumes);

        // Kernel 4: Post-solve - update velocities and handle collisions
        this.kernels.postSolve = Fn(() => {
            If(instanceIndex.lessThan(this.uniforms.vertexCount), () => {
                const objectId = vertexBuffer.get(instanceIndex, 'objectId');
                const size = objectBuffer.get(objectId, 'size');

                If(size.greaterThanEqual(0.0001), () => {
                    const invMass = vertexBuffer.get(instanceIndex, 'invMass').toVar();

                    If(invMass.greaterThan(0.0), () => {
                        const position = vertexBuffer.get(instanceIndex, 'position').toVar();
                        const prevPosition = vertexBuffer.get(instanceIndex, 'prevPosition').toVar();
                        const { sdt, friction } = this.uniforms;

                        // Apply colliders after constraint solving
                        this.colliders.forEach((collider) => {
                            const colliderResult = collider(position);
                            const penetration = colliderResult.w.min(0).negate().toVar();
                            const normal = colliderResult.xyz;

                            If(penetration.greaterThan(0), () => {
                                // Push out of collision
                                position.addAssign(penetration.mul(normal));

                                // Apply friction
                                const currentVel = position.sub(prevPosition).toVar();
                                const normalVel = dot(currentVel, normal).toVar();
                                const tangentVel = currentVel.sub(normal.mul(normalVel)).toVar();
                                const newVel = tangentVel.mul(float(1).sub(friction)).toVar();
                                prevPosition.assign(position.sub(newVel));
                                vertexBuffer.get(instanceIndex, 'prevPosition').assign(prevPosition);
                            });
                        });

                        vertexBuffer.get(instanceIndex, 'position').assign(position);
                    });
                });
            });
        })().compute(this.vertexCount);

        this.renderer.compute(this.kernels.postSolve);

        // Kernel 5: Update tet centroids and quaternions for rendering (still needed for normal rotation)
        this.kernels.updateTets = Fn(() => {
            this.grid.setAtomic(true);
            If(instanceIndex.lessThan(this.uniforms.tetCount), () => {
                const objectId = tetBuffer.get(instanceIndex, 'objectId');
                const size = objectBuffer.get(objectId, 'size');

                If(size.greaterThanEqual(0.0001), () => {
                    const vertexIds = tetBuffer.get(instanceIndex, 'vertexIds').toVar();
                    const pos0 = vertexBuffer.get(vertexIds.x, 'position').toVar();
                    const pos1 = vertexBuffer.get(vertexIds.y, 'position').toVar();
                    const pos2 = vertexBuffer.get(vertexIds.z, 'position').toVar();
                    const pos3 = vertexBuffer.get(vertexIds.w, 'position').toVar();

                    // Reference rest poses (initial positions)
                    const ref0 = restPosesBuffer.get(instanceIndex.mul(4), 'position').toVar();
                    const ref1 = restPosesBuffer.get(instanceIndex.mul(4).add(1), 'position').toVar();
                    const ref2 = restPosesBuffer.get(instanceIndex.mul(4).add(2), 'position').toVar();
                    const ref3 = restPosesBuffer.get(instanceIndex.mul(4).add(3), 'position').toVar();

                    // Compute centroids
                    const curCentroid = pos0.add(pos1).add(pos2).add(pos3).mul(0.25).toVar();
                    const restCentroid = ref0.add(ref1).add(ref2).add(ref3).mul(0.25).toVar();

                    // Center positions for covariance
                    const p0 = pos0.sub(curCentroid).toVar();
                    const p1 = pos1.sub(curCentroid).toVar();
                    const p2 = pos2.sub(curCentroid).toVar();
                    const p3 = pos3.sub(curCentroid).toVar();

                    const r0 = ref0.sub(restCentroid).toVar();
                    const r1 = ref1.sub(restCentroid).toVar();
                    const r2 = ref2.sub(restCentroid).toVar();
                    const r3 = ref3.sub(restCentroid).toVar();

                    // Compute covariance matrix for rotation extraction
                    const covariance = mat3(0, 0, 0, 0, 0, 0, 0, 0, 0).toVar();
                    covariance.element(0).xyz.addAssign(r0.xxx.mul(p0));
                    covariance.element(1).xyz.addAssign(r0.yyy.mul(p0));
                    covariance.element(2).xyz.addAssign(r0.zzz.mul(p0));
                    covariance.element(0).xyz.addAssign(r1.xxx.mul(p1));
                    covariance.element(1).xyz.addAssign(r1.yyy.mul(p1));
                    covariance.element(2).xyz.addAssign(r1.zzz.mul(p1));
                    covariance.element(0).xyz.addAssign(r2.xxx.mul(p2));
                    covariance.element(1).xyz.addAssign(r2.yyy.mul(p2));
                    covariance.element(2).xyz.addAssign(r2.zzz.mul(p2));
                    covariance.element(0).xyz.addAssign(r3.xxx.mul(p3));
                    covariance.element(1).xyz.addAssign(r3.yyy.mul(p3));
                    covariance.element(2).xyz.addAssign(r3.zzz.mul(p3));

                    // Extract rotation
                    const prevQuat = tetBuffer.get(instanceIndex, 'quat').toVar();
                    const rotation = extractRotation(covariance, prevQuat, this.uniforms.rotationRefinementSteps);
                    tetBuffer.get(instanceIndex, 'quat').assign(normalize(rotation));
                    tetBuffer.get(instanceIndex, 'centroid').assign(curCentroid);

                    // Insert into spatial grid for collision detection
                    const gridElement = this.grid.getElement(curCentroid);
                    tetBuffer.get(instanceIndex, 'nextTet').assign(atomicFunc('atomicExchange', gridElement, instanceIndex));
                });
            });
        })().compute(this.tetCount);

        this.renderer.compute(this.kernels.updateTets);

        // Kernel 6: Solve tet-tet collisions (kept for body-body collision)
        this.kernels.solveCollisions = Fn(() => {
            this.grid.setAtomic(false);
            If(instanceIndex.lessThan(this.uniforms.tetCount), () => {
                const objectId = tetBuffer.get(instanceIndex, 'objectId').toVar();
                const size = objectBuffer.get(objectId, 'size');

                If(size.greaterThanEqual(0.0001), () => {
                    const centroid = tetBuffer.get(instanceIndex, 'centroid').toVar('centroid');
                    const position = centroid.toVar('pos');
                    const radius = tetBuffer.get(instanceIndex, 'radius').toVar();
                    const initialPosition = tetBuffer.get(instanceIndex, 'initialPosition').toVar();
                    const vertexIds = tetBuffer.get(instanceIndex, 'vertexIds').toVar();

                    const cellIndex = ivec3(position.div(this.grid.cellsize).floor()).sub(1).toConst('cellIndex');
                    const diff = vec3(0).toVar();
                    const totalForce = float(0).toVar();

                    Loop({ start: 0, end: 3, type: 'int', name: 'gx', condition: '<' }, ({ gx }) => {
                        Loop({ start: 0, end: 3, type: 'int', name: 'gy', condition: '<' }, ({ gy }) => {
                            Loop({ start: 0, end: 3, type: 'int', name: 'gz', condition: '<' }, ({ gz }) => {
                                const cellX = cellIndex.add(ivec3(gx, gy, gz)).toConst();
                                const tetPtr = this.grid.getElementFromIndex(cellX).toVar('tetPtr');
                                Loop(tetPtr.notEqual(int(-1)), () => {
                                    const checkCollision = uint(1).toVar();
                                    const objectId2 = tetBuffer.get(tetPtr, 'objectId');
                                    If(objectId.equal(objectId2), () => {
                                        const initialPosition2 = tetBuffer.get(tetPtr, 'initialPosition');
                                        const delta = initialPosition2.sub(initialPosition).toVar();
                                        const distSquared = dot(delta, delta);
                                        checkCollision.assign(select(distSquared.greaterThan(1.5 * 1.5), uint(1), uint(0)));
                                    });

                                    If(checkCollision.equal(uint(1)), () => {
                                        const centroid_2 = tetBuffer.get(tetPtr, 'centroid').toVar('centroid2');
                                        const radius2 = tetBuffer.get(tetPtr, 'radius').toVar();

                                        const minDist = radius.add(radius2);
                                        const dist = centroid.distance(centroid_2);
                                        const dir = centroid.sub(centroid_2).div(dist.max(0.0001));
                                        const force = minDist.sub(dist).max(0);
                                        totalForce.addAssign(force.div(minDist));
                                        diff.addAssign(dir.mul(force).mul(0.5));
                                    });
                                    tetPtr.assign(tetBuffer.get(tetPtr, 'nextTet'));
                                });
                            });
                        });
                    });

                    If(totalForce.greaterThan(0.0), () => {
                        // Apply collision response to vertices
                        vertexBuffer.get(vertexIds.x, 'position').addAssign(diff);
                        vertexBuffer.get(vertexIds.y, 'position').addAssign(diff);
                        vertexBuffer.get(vertexIds.z, 'position').addAssign(diff);
                        vertexBuffer.get(vertexIds.w, 'position').addAssign(diff);
                    });
                });
            });
        })().compute(this.tetCount);

        this.renderer.compute(this.kernels.solveCollisions);

        // Reset kernels
        this._compileResetKernels();

        // Mouse interaction kernel
        this._compileMouseKernel();

        // Position readback kernel
        this._compileReadbackKernel();
    }

    /**
     * Compiles reset kernels
     */
    async _compileResetKernels() {
        const { tetBuffer, vertexBuffer, objectBuffer, restPosesBuffer } = this.buffers;

        this.uniforms.resetVertexStart = uniform(0, 'uint');
        this.uniforms.resetVertexCount = uniform(0, 'uint');
        this.uniforms.resetVelocity = uniform(new THREE.Vector3());
        this.uniforms.resetMatrix = uniform(new THREE.Matrix4());
        this.uniforms.resetQuat = uniform(new THREE.Vector4());
        this.uniforms.resetScale = uniform(1.0, 'float');

        this.kernels.resetVertices = Fn(() => {
            If(instanceIndex.lessThan(this.uniforms.resetVertexCount), () => {
                const vertexId = this.uniforms.resetVertexStart.add(instanceIndex).toVar();

                If(instanceIndex.equal(uint(0)), () => {
                    const objectId = vertexBuffer.get(vertexId, 'objectId').toVar();
                    objectBuffer.get(objectId, 'size').assign(1.0);
                });

                const initialPosition = this.uniforms.resetMatrix.mul(vec4(vertexBuffer.get(vertexId, 'initialPosition').xyz, 1)).xyz.toVar();
                vertexBuffer.get(vertexId, 'position').assign(initialPosition);
                vertexBuffer.get(vertexId, 'prevPosition').assign(initialPosition.sub(this.uniforms.resetVelocity));
            });
        })().compute(this.vertexCount);

        this.renderer.compute(this.kernels.resetVertices);

        this.uniforms.resetTetStart = uniform(0, 'uint');
        this.uniforms.resetTetCount = uniform(0, 'uint');

        this.kernels.resetTets = Fn(() => {
            If(instanceIndex.lessThan(this.uniforms.resetTetCount), () => {
                const tetId = this.uniforms.resetTetStart.add(instanceIndex).toVar();

                const vertexIds = tetBuffer.get(tetId, 'vertexIds');
                const pos0 = this.uniforms.resetMatrix.mul(vec4(vertexBuffer.get(vertexIds.x, 'initialPosition').xyz, 1)).xyz.toVar();
                const pos1 = this.uniforms.resetMatrix.mul(vec4(vertexBuffer.get(vertexIds.y, 'initialPosition').xyz, 1)).xyz.toVar();
                const pos2 = this.uniforms.resetMatrix.mul(vec4(vertexBuffer.get(vertexIds.z, 'initialPosition').xyz, 1)).xyz.toVar();
                const pos3 = this.uniforms.resetMatrix.mul(vec4(vertexBuffer.get(vertexIds.w, 'initialPosition').xyz, 1)).xyz.toVar();

                // Calculate centroid and radius from transformed positions
                const centroid = pos0.add(pos1).add(pos2).add(pos3).mul(0.25).toVar();
                tetBuffer.get(tetId, 'centroid').assign(centroid);

                // Calculate scaled radius from transformed tet volume
                // Volume = |det(v1-v0, v2-v0, v3-v0)| / 6
                const a = pos1.sub(pos0).toVar();
                const b = pos2.sub(pos0).toVar();
                const c = pos3.sub(pos0).toVar();
                const crossAB = cross(a, b);
                const volume = dot(crossAB, c).abs().div(6.0).toVar();
                // Radius from volume: r = (3V / 4π)^(1/3)
                const scaledRadius = volume.mul(0.75 / Math.PI).pow(1.0 / 3.0);
                tetBuffer.get(tetId, 'radius').assign(scaledRadius);

                restPosesBuffer.get(tetId.mul(4), 'position').assign(pos0);
                restPosesBuffer.get(tetId.mul(4).add(1), 'position').assign(pos1);
                restPosesBuffer.get(tetId.mul(4).add(2), 'position').assign(pos2);
                restPosesBuffer.get(tetId.mul(4).add(3), 'position').assign(pos3);
                tetBuffer.get(tetId, 'quat').assign(this.uniforms.resetQuat);
            });
        })().compute(this.tetCount);

        this.renderer.compute(this.kernels.resetTets);

        this.uniforms.objectStart = uniform(0, 'uint');
        this.kernels.resetObjects = Fn(() => {
            const objectId = this.uniforms.objectStart.add(instanceIndex).toVar();
            objectBuffer.get(objectId, 'size').assign(0.0);
        })().compute(this.objects.length);
    }

    /**
     * Compiles mouse interaction kernel
     */
    async _compileMouseKernel() {
        const { vertexBuffer, objectBuffer } = this.buffers;

        this.uniforms.mouseRayOrigin = uniform(new THREE.Vector3());
        this.uniforms.mouseRayDirection = uniform(new THREE.Vector3());
        this.uniforms.mouseForce = uniform(new THREE.Vector3(0, -0.25, 0));

        this.kernels.applyMouseEvent = Fn(() => {
            If(instanceIndex.lessThan(this.uniforms.vertexCount), () => {
                const objectId = vertexBuffer.get(instanceIndex, 'objectId');
                const size = objectBuffer.get(objectId, 'size');

                If(size.greaterThanEqual(0.0001), () => {
                    const { mouseRayOrigin, mouseRayDirection, mouseForce } = this.uniforms;
                    const position = vertexBuffer.get(instanceIndex, 'position').toVar();
                    const prevPosition = vertexBuffer.get(instanceIndex, 'prevPosition');

                    const dist = cross(mouseRayDirection, position.sub(mouseRayOrigin)).length();
                    const force = dist.mul(0.3).oneMinus().max(0.0).pow(0.5);
                    prevPosition.addAssign(mouseForce.mul(force));
                });
            });
        })().compute(this.vertexCount);

        this.renderer.compute(this.kernels.applyMouseEvent);

        // Drag constraint kernel
        await this._compileDragKernel();
    }

    /**
     * Compiles drag constraint kernel
     */
    async _compileDragKernel() {
        const { vertexBuffer } = this.buffers;

        this.uniforms.dragActive = uniform(0, 'int');
        this.uniforms.dragVertexId = uniform(0, 'uint');
        this.uniforms.dragTargetPosition = uniform(new THREE.Vector3());
        this.uniforms.dragStrength = uniform(0.5, 'float');

        // Single vertex drag kernel - only runs on one vertex
        this.kernels.applyDrag = Fn(() => {
            If(this.uniforms.dragActive.equal(int(1)), () => {
                const vertexId = this.uniforms.dragVertexId;
                const { dragTargetPosition, dragStrength } = this.uniforms;

                const position = vertexBuffer.get(vertexId, 'position').toVar();
                const prevPosition = vertexBuffer.get(vertexId, 'prevPosition').toVar();

                // Move position toward target
                const toTarget = dragTargetPosition.sub(position).toVar();
                const moveAmount = toTarget.mul(dragStrength).toVar();
                position.addAssign(moveAmount);

                // Update prev position to reduce velocity (prevents bouncing back)
                const velocity = position.sub(prevPosition).toVar();
                prevPosition.assign(position.sub(velocity.mul(0.5)));

                vertexBuffer.get(vertexId, 'position').assign(position);
                vertexBuffer.get(vertexId, 'prevPosition').assign(prevPosition);
            });
        })().compute(1);

        this.renderer.compute(this.kernels.applyDrag);
    }

    /**
     * Compiles position readback kernel
     */
    async _compileReadbackKernel() {
        const { vertexBuffer } = this.buffers;

        const centerVertexArray = new Uint32Array(this.objectData.map(d => d.centerVertex.id));
        this.buffers.centerVertexBuffer = instancedArray(centerVertexArray, 'uint');
        this.buffers.positionReadbackBuffer = instancedArray(new Float32Array(this.objects.length * 3), 'vec3');

        this.kernels.readPositions = Fn(() => {
            const centerVertex = this.buffers.centerVertexBuffer.element(instanceIndex);
            const position = vertexBuffer.get(centerVertex, 'position');
            this.buffers.positionReadbackBuffer.element(instanceIndex).assign(position);
        })().compute(this.objects.length);

        this.renderer.compute(this.kernels.readPositions);

        // All vertex positions readback buffer (vec3 is padded to vec4 in WebGPU)
        this.buffers.allVertexPositionsBuffer = instancedArray(new Float32Array(this.vertexCount * 4), 'vec4');

        this.kernels.readAllVertexPositions = Fn(() => {
            If(instanceIndex.lessThan(this.uniforms.vertexCount), () => {
                const position = vertexBuffer.get(instanceIndex, 'position');
                this.buffers.allVertexPositionsBuffer.element(instanceIndex).assign(vec4(position, float(0)));
            });
        })().compute(this.vertexCount);

        this.renderer.compute(this.kernels.readAllVertexPositions);
    }

    /**
     * Reads positions from GPU back to CPU
     */
    async readPositions() {
        this.renderer.compute(this.kernels.readPositions);
        const positions = new Float32Array(await this.renderer.getArrayBufferAsync(this.buffers.positionReadbackBuffer.value));
        this.objectData.forEach((o, index) => {
            o.position.set(positions[index * 4], positions[index * 4 + 1], positions[index * 4 + 2]);
        });
    }

    /**
     * Reads all vertex positions from GPU back to CPU
     * @returns {Float32Array} Array of vertex positions (x, y, z, padding for each vertex)
     */
    async readAllVertexPositions() {
        this.renderer.compute(this.kernels.readAllVertexPositions);
        return new Float32Array(await this.renderer.getArrayBufferAsync(this.buffers.allVertexPositionsBuffer.value));
    }

    /**
     * Gets the position of a single vertex
     * @param {number} vertexId - Vertex ID
     * @returns {Promise<THREE.Vector3>} Vertex position
     */
    async getVertexPosition(vertexId) {
        const positions = await this.readAllVertexPositions();
        return new THREE.Vector3(
            positions[vertexId * 4],
            positions[vertexId * 4 + 1],
            positions[vertexId * 4 + 2]
        );
    }

    /**
     * Finds the nearest vertex to a ray
     * @param {THREE.Vector3} rayOrigin - Ray origin
     * @param {THREE.Vector3} rayDirection - Ray direction (normalized)
     * @param {number} [maxDistance=Infinity] - Maximum distance from ray to vertex
     * @returns {Promise<Object|null>} { vertexId, position, distance } or null if none found
     */
    async findNearestVertex(rayOrigin, rayDirection, maxDistance = Infinity) {
        const positions = await this.readAllVertexPositions();

        let closestProjLength = Infinity;
        let closestVertex = null;

        for (let i = 0; i < this.vertexCount; i++) {
            // Check if this vertex's object is spawned
            const objectId = this.vertices[i].objectId;
            if (!this.objects[objectId]?.spawned) continue;

            const px = positions[i * 4];
            const py = positions[i * 4 + 1];
            const pz = positions[i * 4 + 2];

            // Vector from ray origin to vertex
            const toPointX = px - rayOrigin.x;
            const toPointY = py - rayOrigin.y;
            const toPointZ = pz - rayOrigin.z;

            // Project onto ray direction
            const projLength = toPointX * rayDirection.x + toPointY * rayDirection.y + toPointZ * rayDirection.z;

            if (projLength < 0) continue; // Behind camera

            // Closest point on ray
            const closestX = rayOrigin.x + rayDirection.x * projLength;
            const closestY = rayOrigin.y + rayDirection.y * projLength;
            const closestZ = rayOrigin.z + rayDirection.z * projLength;

            // Distance from vertex to closest point on ray (perpendicular distance)
            const dx = px - closestX;
            const dy = py - closestY;
            const dz = pz - closestZ;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            // Pick the vertex closest to ray origin among those within maxDistance from the ray
            if (dist < maxDistance && projLength < closestProjLength) {
                closestProjLength = projLength;
                closestVertex = {
                    vertexId: i,
                    position: new THREE.Vector3(px, py, pz),
                    distance: projLength
                };
            }
        }

        return closestVertex;
    }

    /**
     * Resets an object to a new position
     * @param {number} id - Object ID
     * @param {THREE.Vector3} position - New position
     * @param {THREE.Quaternion} quaternion - New rotation
     * @param {THREE.Vector3} scale - New scale
     * @param {THREE.Vector3} [velocity] - Initial velocity
     */
    async resetObject(id, position, quaternion, scale, velocity = new THREE.Vector3()) {
        this.objectData[id].position.copy(position);

        this.uniforms.resetMatrix.value.compose(position, quaternion, scale);
        this.uniforms.resetQuat.value.copy(quaternion);
        this.uniforms.resetScale.value = (scale.x + scale.y + scale.z) / 3; // Average scale for radius
        this.uniforms.resetVertexStart.value = this.objectData[id].vertexStart;
        this.uniforms.resetVertexCount.value = this.objectData[id].vertexCount;
        this.uniforms.resetTetStart.value = this.objectData[id].tetStart;
        this.uniforms.resetTetCount.value = this.objectData[id].tetCount;
        this.uniforms.resetVelocity.value.copy(velocity);

        this.kernels.resetVertices.count = this.objectData[id].vertexCount;
        this.kernels.resetTets.count = this.objectData[id].tetCount;
        //this.kernels.resetVertices.updateDispatchCount();
        //this.kernels.resetTets.updateDispatchCount();

        this.renderer.compute(this.kernels.resetVertices);
        this.renderer.compute(this.kernels.resetTets);
    }

    /**
     * Applies a mouse interaction
     * @param {THREE.Vector3} origin - Ray origin
     * @param {THREE.Vector3} direction - Ray direction
     * @param {THREE.Vector3} [force] - Force to apply
     */
    async onPointerDown(origin, direction, force = new THREE.Vector3(0, -0.25, 0)) {
        this.uniforms.mouseRayOrigin.value.copy(origin);
        this.uniforms.mouseRayDirection.value.copy(direction);
        this.uniforms.mouseForce.value.copy(force);
        this.renderer.compute(this.kernels.applyMouseEvent);
    }

    /**
     * Starts dragging a vertex toward a target position
     * @param {number} vertexId - Vertex ID to drag
     * @param {THREE.Vector3} targetPosition - Target position
     * @param {number} [strength=0.5] - Drag strength (0-1)
     */
    startDrag(vertexId, targetPosition, strength = 0.5) {
        this.dragActive = true;
        this.dragVertexId = vertexId;
        this.dragTargetPosition.copy(targetPosition);
        this.dragStrength = strength;

        this.uniforms.dragActive.value = 1;
        this.uniforms.dragVertexId.value = vertexId;
        this.uniforms.dragTargetPosition.value.copy(targetPosition);
        this.uniforms.dragStrength.value = strength;
    }

    /**
     * Updates the drag target position
     * @param {THREE.Vector3} targetPosition - New target position
     */
    updateDrag(targetPosition) {
        if (!this.dragActive) return;

        this.dragTargetPosition.copy(targetPosition);
        this.uniforms.dragTargetPosition.value.copy(targetPosition);
    }

    /**
     * Ends the drag constraint
     */
    endDrag() {
        this.dragActive = false;
        this.dragVertexId = -1;
        this.uniforms.dragActive.value = 0;
    }

    /**
     * Updates the simulation
     * @param {number} deltaTime - Time since last frame
     * @param {number} [elapsed] - Total elapsed time
     */
    async update(deltaTime, elapsed = 0) {
        if (!this.initialized) return;

        this.frameNum++;

        const timePerStep = 1 / this.config.stepsPerSecond;
        deltaTime = Math.max(Math.min(deltaTime, 1 / 60), 0.0001);
        this.uniforms.dt.value = timePerStep;
        this.timeSinceLastStep += deltaTime;

        // Update objects
        for (const object of this.objects) {
            await object.update(deltaTime, elapsed);
        }

        // Run physics steps
        while (this.timeSinceLastStep >= timePerStep) {
            this.time += timePerStep;
            this.timeSinceLastStep -= timePerStep;
            this.uniforms.time.value = this.time;

            // XPBD substep dt
            const sdt = timePerStep / this.config.numSubsteps;
            this.uniforms.sdt.value = sdt;

            // Run XPBD substeps
            for (let substep = 0; substep < this.config.numSubsteps; substep++) {
                // Pre-solve: apply gravity and predict positions
                this.renderer.compute(this.kernels.preSolve);

                // Solve constraints
                this.renderer.compute(this.kernels.solveEdges);
                this.renderer.compute(this.kernels.solveVolumes);

                // Post-solve: handle collisions after constraints
                this.renderer.compute(this.kernels.postSolve);

                // Apply drag constraint if active
                if (this.dragActive) {
                    this.renderer.compute(this.kernels.applyDrag);
                }
            }

            // Update tet data for rendering (rotation, centroid)
            this.grid.clearBuffer(this.renderer);
            this.renderer.compute(this.kernels.updateTets);

            // Solve tet-tet collisions
            this.renderer.compute(this.kernels.solveCollisions);
        }

        // Periodic position readback
        if (this.frameNum % 50 === 0) {
            this.readPositions();
        }
    }

    /**
     * Sets the number of active bodies
     * @param {number} count - Number of active bodies
     */
    async setActiveBodyCount(count) {
        if (count === this.objectCount) return;

        this.objectCount = count;
        for (let i = count; i < this.objects.length; i++) {
            this.objects[i].spawned = false;
        }

        this.geometries.forEach(geom => geom.updateCount());

        const lastObject = this.objectData[count - 1];
        const tetCount = lastObject.tetStart + lastObject.tetCount;
        const vertexCount = lastObject.vertexStart + lastObject.vertexCount;

        this.uniforms.tetCount.value = tetCount;
        this.uniforms.vertexCount.value = vertexCount;
        // Note: edgeCount is global and doesn't change with active body count

        // Update kernel dispatch counts for new solvers
        this.kernels.preSolve.count = vertexCount;
        this.kernels.solveEdges.count = this.edgeCount; // All edges need to be checked
        this.kernels.solveVolumes.count = tetCount;
        this.kernels.postSolve.count = vertexCount;
        this.kernels.updateTets.count = tetCount;
        this.kernels.solveCollisions.count = tetCount;
        this.kernels.applyMouseEvent.count = vertexCount;

        this.uniforms.objectStart.value = count;
        this.renderer.compute(this.kernels.resetObjects);
    }

    /**
     * Disposes all GPU resources
     */
    dispose() {
        Object.keys(this.kernels).forEach(key => {
            this.kernels[key].dispose();
        });
        this.geometries.forEach(geom => geom.dispose());
    }
}
