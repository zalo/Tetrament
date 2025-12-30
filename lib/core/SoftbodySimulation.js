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
    atomicFunc
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

/**
 * Configuration options for the simulation
 * @typedef {Object} SimulationConfig
 * @property {number} [stepsPerSecond=180] - Physics steps per second
 * @property {THREE.Vector3} [gravity] - Gravity vector (default: 0, -19.62, 0)
 * @property {number} [damping=0.999] - Velocity damping
 * @property {number} [friction=0.3] - Surface friction coefficient (0-1)
 * @property {number} [rotationSteps=2] - Rotation extraction iterations
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
            stepsPerSecond: config.stepsPerSecond ?? 180,
            gravity: config.gravity ?? new THREE.Vector3(0, -19.62, 0),
            damping: config.damping ?? 0.999,
            friction: config.friction ?? 0.3,
            rotationSteps: config.rotationSteps ?? 2
        };

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

        // Fill tet data
        let maxRadius = 0;
        this.tets.forEach((tet, index) => {
            const { v0, v1, v2, v3 } = tet;
            const center = v0.clone().add(v1).add(v2).add(v3).multiplyScalar(0.25);
            const a = v1.clone().sub(v0);
            const b = v2.clone().sub(v0);
            const c = v3.clone().sub(v0);
            const V = Math.abs(a.cross(b).dot(c)) / 6;
            const radius = Math.pow((3 / 4) * V / Math.PI, 1 / 3);
            maxRadius = Math.max(maxRadius, radius);

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

        // Create vertex buffer
        const vertexStruct = {
            objectId: 'uint',
            influencerPtr: 'uint',
            influencerCount: 'uint',
            initialPosition: 'vec3',
            position: 'vec3',
            prevPosition: 'vec3'
        };
        const vertexBuffer = new StructuredArray(vertexStruct, this.vertexCount, 'vertices');
        this.buffers.vertexBuffer = vertexBuffer;

        // Fill vertex data
        const influencerArray = new Uint32Array(this.tetCount * 4);
        let influencerPtr = 0;
        this.vertices.forEach((vertex, index) => {
            vertexBuffer.set(index, 'initialPosition', vertex);
            vertexBuffer.set(index, 'prevPosition', vertex);
            vertexBuffer.set(index, 'influencerPtr', influencerPtr);
            vertexBuffer.set(index, 'influencerCount', vertex.influencers.length);
            vertexBuffer.set(index, 'objectId', vertex.objectId);

            vertex.influencers.forEach(influencer => {
                influencerArray[influencerPtr] = influencer;
                influencerPtr++;
            });
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
        this.uniforms.time = uniform(0, 'float');
        this.uniforms.dt = uniform(1, 'float');
        this.uniforms.gravity = uniform(this.config.gravity, 'vec3');
        this.uniforms.friction = uniform(this.config.friction, 'float');
        this.uniforms.rotationRefinementSteps = uniform(this.config.rotationSteps, 'int');

        // Compile kernels
        await this._compileKernels();

        // Bake geometries
        const geometryPromises = this.geometries.map(geom => geom.bake(this));
        await Promise.all(geometryPromises);

        this.initialized = true;
    }

    /**
     * Compiles GPU compute shaders
     */
    async _compileKernels() {
        const { tetBuffer, vertexBuffer, objectBuffer, restPosesBuffer, influencerBuffer } = this.buffers;

        // Clear grid
        await this.grid.clearBuffer(this.renderer);

        // Kernel 1: Solve element pass (rotation extraction)
        this.kernels.solveElemPass = Fn(() => {
            this.grid.setAtomic(true);
            // Use nested If to avoid unreachable code warnings
            If(instanceIndex.lessThan(this.uniforms.tetCount), () => {
                const objectId = tetBuffer.get(instanceIndex, 'objectId');
                const size = objectBuffer.get(objectId, 'size');

                If(size.greaterThanEqual(0.0001), () => {
                    // Gather vertex positions
                    const vertexIds = tetBuffer.get(instanceIndex, 'vertexIds').toVar();
                    const pos0 = vertexBuffer.get(vertexIds.x, 'position').toVar();
                    const pos1 = vertexBuffer.get(vertexIds.y, 'position').toVar();
                    const pos2 = vertexBuffer.get(vertexIds.z, 'position').toVar();
                    const pos3 = vertexBuffer.get(vertexIds.w, 'position').toVar();

                    // Reference rest poses
                    const ref0 = restPosesBuffer.get(instanceIndex.mul(4), 'position').toVar();
                    const ref1 = restPosesBuffer.get(instanceIndex.mul(4).add(1), 'position').toVar();
                    const ref2 = restPosesBuffer.get(instanceIndex.mul(4).add(2), 'position').toVar();
                    const ref3 = restPosesBuffer.get(instanceIndex.mul(4).add(3), 'position').toVar();

                    // Centroids
                    const curCentroid = pos0.add(pos1).add(pos2).add(pos3).mul(0.25).toVar();
                    const lastRestCentroid = ref0.add(ref1).add(ref2).add(ref3).mul(0.25).toVar();

                    // Center positions
                    pos0.subAssign(curCentroid);
                    pos1.subAssign(curCentroid);
                    pos2.subAssign(curCentroid);
                    pos3.subAssign(curCentroid);

                    ref0.subAssign(lastRestCentroid);
                    ref1.subAssign(lastRestCentroid);
                    ref2.subAssign(lastRestCentroid);
                    ref3.subAssign(lastRestCentroid);

                    // Compute covariance matrix
                    const covariance = mat3(0, 0, 0, 0, 0, 0, 0, 0, 0).toVar();
                    covariance.element(0).xyz.addAssign(ref0.xxx.mul(pos0));
                    covariance.element(1).xyz.addAssign(ref0.yyy.mul(pos0));
                    covariance.element(2).xyz.addAssign(ref0.zzz.mul(pos0));
                    covariance.element(0).xyz.addAssign(ref1.xxx.mul(pos1));
                    covariance.element(1).xyz.addAssign(ref1.yyy.mul(pos1));
                    covariance.element(2).xyz.addAssign(ref1.zzz.mul(pos1));
                    covariance.element(0).xyz.addAssign(ref2.xxx.mul(pos2));
                    covariance.element(1).xyz.addAssign(ref2.yyy.mul(pos2));
                    covariance.element(2).xyz.addAssign(ref2.zzz.mul(pos2));
                    covariance.element(0).xyz.addAssign(ref3.xxx.mul(pos3));
                    covariance.element(1).xyz.addAssign(ref3.yyy.mul(pos3));
                    covariance.element(2).xyz.addAssign(ref3.zzz.mul(pos3));

                    // Extract rotation
                    const rotation = extractRotation(covariance, vec4(0.0, 0.0, 0.0, 1.0), this.uniforms.rotationRefinementSteps);

                    // Update quaternion
                    const prevQuat = tetBuffer.get(instanceIndex, 'quat').toVar();
                    const newQuat = normalize(quat_mult(rotation, prevQuat));
                    tetBuffer.get(instanceIndex, 'quat').assign(newQuat);

                    const relativeQuat = normalize(quat_mult(newQuat, quat_conj(prevQuat)));

                    // Rotate rest poses
                    ref0.assign(rotateByQuat(ref0, relativeQuat).add(curCentroid));
                    ref1.assign(rotateByQuat(ref1, relativeQuat).add(curCentroid));
                    ref2.assign(rotateByQuat(ref2, relativeQuat).add(curCentroid));
                    ref3.assign(rotateByQuat(ref3, relativeQuat).add(curCentroid));

                    tetBuffer.get(instanceIndex, 'centroid').assign(curCentroid);
                    restPosesBuffer.get(instanceIndex.mul(4), 'position').assign(ref0);
                    restPosesBuffer.get(instanceIndex.mul(4).add(1), 'position').assign(ref1);
                    restPosesBuffer.get(instanceIndex.mul(4).add(2), 'position').assign(ref2);
                    restPosesBuffer.get(instanceIndex.mul(4).add(3), 'position').assign(ref3);

                    // Insert into spatial grid
                    const gridElement = this.grid.getElement(curCentroid);
                    tetBuffer.get(instanceIndex, 'nextTet').assign(atomicFunc('atomicExchange', gridElement, instanceIndex));
                });
            });
        })().compute(this.tetCount);

        await this.renderer.computeAsync(this.kernels.solveElemPass);

        // Kernel 2: Solve collisions
        this.kernels.solveCollisions = Fn(() => {
            this.grid.setAtomic(false);
            // Use nested If to avoid unreachable code warnings
            If(instanceIndex.lessThan(this.uniforms.tetCount), () => {
                const objectId = tetBuffer.get(instanceIndex, 'objectId').toVar();
                const size = objectBuffer.get(objectId, 'size');

                If(size.greaterThanEqual(0.0001), () => {
                    const centroid = tetBuffer.get(instanceIndex, 'centroid').toVar('centroid');
                    const position = centroid.toVar('pos');
                    const radius = tetBuffer.get(instanceIndex, 'radius').toVar();
                    const initialPosition = tetBuffer.get(instanceIndex, 'initialPosition').toVar();

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
                                        const dir = centroid.sub(centroid_2).div(dist);
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
                        restPosesBuffer.get(instanceIndex.mul(4), 'position').addAssign(diff);
                        restPosesBuffer.get(instanceIndex.mul(4).add(1), 'position').addAssign(diff);
                        restPosesBuffer.get(instanceIndex.mul(4).add(2), 'position').addAssign(diff);
                        restPosesBuffer.get(instanceIndex.mul(4).add(3), 'position').addAssign(diff);
                    });
                });
            });
        })().compute(this.tetCount);

        await this.renderer.computeAsync(this.kernels.solveCollisions);

        // Kernel 3: Apply element pass (vertex integration)
        this.kernels.applyElemPass = Fn(() => {
            // Use If/Else to avoid unreachable code warnings
            If(instanceIndex.lessThan(this.uniforms.vertexCount), () => {
                const objectId = vertexBuffer.get(instanceIndex, 'objectId');
                const size = objectBuffer.get(objectId, 'size');

                If(size.greaterThanEqual(0.0001), () => {
                    const prevPosition = vertexBuffer.get(instanceIndex, 'prevPosition').toVar();
                    const ptrStart = vertexBuffer.get(instanceIndex, 'influencerPtr').toVar();
                    const ptrEnd = ptrStart.add(vertexBuffer.get(instanceIndex, 'influencerCount')).toVar();
                    const position = vec3().toVar();
                    const weight = float().toVar();

                    Loop({ start: ptrStart, end: ptrEnd, type: 'uint', condition: '<' }, ({ i }) => {
                        const restPositionPtr = influencerBuffer.element(i);
                        const restPosition = restPosesBuffer.get(restPositionPtr, 'position');
                        const restVolume = restPosesBuffer.get(restPositionPtr, 'restVolume');
                        position.addAssign(restPosition.mul(restVolume));
                        weight.addAssign(restVolume);
                    });
                    position.divAssign(weight);

                    // Store rest position for next frame's velocity calculation
                    const restPos = position.toVar();

                    const { dt, gravity, friction } = this.uniforms;
                    const velocity = position.sub(prevPosition).div(dt).add(gravity.mul(dt)).mul(this.config.damping).toVar();
                    position.addAssign(velocity.mul(dt));

                    // Apply colliders with friction
                    // In Verlet integration: velocity is implicit in (position - prevPosition)
                    // For friction, we adjust restPos to reduce tangential velocity for next frame
                    this.colliders.forEach((collider) => {
                        const colliderResult = collider(position);
                        const penetration = colliderResult.w.min(0).negate().toVar();
                        const normal = colliderResult.xyz;

                        // Only apply if penetrating
                        If(penetration.greaterThan(0), () => {
                            // Push out of collision
                            position.addAssign(penetration.mul(normal));

                            // Apply friction: reduce tangential velocity component
                            // Current velocity = (position - restPos) / dt
                            const currentVel = position.sub(restPos).div(dt).toVar();
                            const normalVel = dot(currentVel, normal).toVar();
                            const tangentVel = currentVel.sub(normal.mul(normalVel)).toVar();

                            // New velocity: reduce tangent velocity by friction, zero out normal component (no bounce)
                            const newVel = tangentVel.mul(float(1).sub(friction)).toVar();

                            // Update restPos so that next frame sees reduced velocity
                            // restPos = position - newVel * dt
                            restPos.assign(position.sub(newVel.mul(dt)));
                        });
                    });

                    vertexBuffer.get(instanceIndex, 'prevPosition').assign(restPos);
                    vertexBuffer.get(instanceIndex, 'position').assign(position);
                });
            });
        })().compute(this.vertexCount);

        await this.renderer.computeAsync(this.kernels.applyElemPass);

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

        await this.renderer.computeAsync(this.kernels.resetVertices);

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

        await this.renderer.computeAsync(this.kernels.resetTets);

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

        await this.renderer.computeAsync(this.kernels.applyMouseEvent);

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

        await this.renderer.computeAsync(this.kernels.applyDrag);
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

        await this.renderer.computeAsync(this.kernels.readPositions);

        // All vertex positions readback buffer (vec3 is padded to vec4 in WebGPU)
        this.buffers.allVertexPositionsBuffer = instancedArray(new Float32Array(this.vertexCount * 4), 'vec4');

        this.kernels.readAllVertexPositions = Fn(() => {
            If(instanceIndex.lessThan(this.uniforms.vertexCount), () => {
                const position = vertexBuffer.get(instanceIndex, 'position');
                this.buffers.allVertexPositionsBuffer.element(instanceIndex).assign(vec4(position, float(0)));
            });
        })().compute(this.vertexCount);

        await this.renderer.computeAsync(this.kernels.readAllVertexPositions);
    }

    /**
     * Reads positions from GPU back to CPU
     */
    async readPositions() {
        await this.renderer.computeAsync(this.kernels.readPositions);
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
        await this.renderer.computeAsync(this.kernels.readAllVertexPositions);
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

        let closestDist = Infinity;
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

            // Distance from vertex to closest point on ray
            const dx = px - closestX;
            const dy = py - closestY;
            const dz = pz - closestZ;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist < closestDist && dist < maxDistance) {
                closestDist = dist;
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
        this.kernels.resetVertices.updateDispatchCount();
        this.kernels.resetTets.updateDispatchCount();

        await this.renderer.computeAsync(this.kernels.resetVertices);
        await this.renderer.computeAsync(this.kernels.resetTets);
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
        await this.renderer.computeAsync(this.kernels.applyMouseEvent);
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

            await this.grid.clearBuffer(this.renderer);
            await this.renderer.computeAsync(this.kernels.solveElemPass);
            await this.renderer.computeAsync(this.kernels.solveCollisions);
            await this.renderer.computeAsync(this.kernels.applyElemPass);

            // Apply drag constraint if active
            if (this.dragActive) {
                await this.renderer.computeAsync(this.kernels.applyDrag);
            }
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

        this.kernels.solveElemPass.count = tetCount;
        this.kernels.solveCollisions.count = tetCount;
        this.kernels.applyElemPass.count = vertexCount;
        this.kernels.applyMouseEvent.count = vertexCount;

        this.kernels.solveElemPass.updateDispatchCount();
        this.kernels.solveCollisions.updateDispatchCount();
        this.kernels.applyElemPass.updateDispatchCount();
        this.kernels.applyMouseEvent.updateDispatchCount();

        this.uniforms.objectStart.value = count;
        await this.renderer.computeAsync(this.kernels.resetObjects);
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
