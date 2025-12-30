/**
 * Softbody geometry for rendering deformable meshes
 * @module tetrament/core/SoftbodyGeometry
 */

import * as THREE from 'three/webgpu';
import {
    attribute,
    cross,
    float,
    Fn,
    mul,
    transformNormalToView,
    varying,
    vec3,
    vec4
} from 'three/tsl';

import { rotateByQuat } from './shaderMath.js';
import { SoftbodyInstance } from './SoftbodyInstance.js';

/**
 * Manages the rendering geometry for a softbody model
 */
export class SoftbodyGeometry {
    /**
     * @param {SoftbodySimulation} physics - Physics simulation
     * @param {Object} model - Model data
     * @param {typeof THREE.MeshPhysicalNodeMaterial} materialClass - Material class
     */
    constructor(physics, model, materialClass) {
        this.physics = physics;
        this.model = model;
        this.instances = [];
        this.geometry = null;
        this.material = null;
        this.mesh = null;

        this.createMaterial(materialClass);
    }

    /**
     * Creates the instanced buffer geometry
     */
    createGeometry() {
        const { attachedTets, baryCoords, positions, normals, uvs, indices, tetVerts, tetIds } = this.model;
        const instanceCount = this.instances.length;
        if (instanceCount === 0) return;

        // Remove old mesh if rebaking
        if (this.mesh) {
            this.physics.object.remove(this.mesh);
            this.geometry?.dispose();
        }

        const vertexCount = attachedTets.length;
        const positionArray = new Float32Array(positions);
        const normalArray = new Float32Array(normals);
        const uvArray = new Float32Array(uvs);
        const tetIdArray = new Uint32Array(vertexCount);
        const vertexIdArray = new Uint32Array(vertexCount * 4);
        const tetBaryCoordsArray = new Float32Array(baryCoords);

        const instanceDataArray = new Uint32Array(instanceCount * 3);

        for (let i = 0; i < instanceCount; i++) {
            const instance = this.instances[i];
            instanceDataArray[i * 3] = instance.id;
            instanceDataArray[i * 3 + 1] = instance.tetOffset;
            instanceDataArray[i * 3 + 2] = instance.vertexOffset;
        }

        for (let i = 0; i < vertexCount; i++) {
            const tetId = attachedTets[i];
            tetIdArray[i] = tetId;
            vertexIdArray[i * 4] = tetIds[tetId * 4];
            vertexIdArray[i * 4 + 1] = tetIds[tetId * 4 + 1];
            vertexIdArray[i * 4 + 2] = tetIds[tetId * 4 + 2];
            vertexIdArray[i * 4 + 3] = tetIds[tetId * 4 + 3];
        }

        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3, false));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3, false));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2, false));
        geometry.setAttribute('tetId', new THREE.BufferAttribute(tetIdArray, 1, false));
        geometry.setAttribute('vertexIds', new THREE.BufferAttribute(vertexIdArray, 4, false));
        geometry.setAttribute('tetBaryCoords', new THREE.BufferAttribute(tetBaryCoordsArray, 3, false));
        geometry.setAttribute('instanceData', new THREE.InstancedBufferAttribute(instanceDataArray, 3, false));
        geometry.setIndex(indices);
        geometry.instanceCount = instanceCount;

        this.geometry = geometry;

        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        this.mesh = mesh;
        this.physics.object.add(mesh);
    }

    /**
     * Updates the instance count
     */
    updateCount() {
        if (this.instances.length === 0) return;
        const totalCount = this.physics.objectCount;
        const count = this.instances.filter(i => i.id < totalCount && i.spawned).length;
        this.geometry.instanceCount = count;
    }

    /**
     * Adds a new instance of this geometry
     * @returns {SoftbodyInstance}
     */
    addInstance() {
        const instance = new SoftbodyInstance(this.physics, this);
        this.instances.push(instance);
        return instance;
    }

    /**
     * Bakes the geometry (creates buffers)
     */
    async bake() {
        this.createGeometry();
    }

    /**
     * Creates the material with vertex shader for deformation
     * @param {typeof THREE.MeshPhysicalNodeMaterial} materialClass
     */
    createMaterial(materialClass) {
        const material = new materialClass();

        const vNormal = varying(vec3(0), 'v_normalView');
        const vDistance = varying(float(0), 'v_distance');

        material.positionNode = Fn(() => {
            const objectId = attribute('instanceData').x;
            const tetOffset = attribute('instanceData').y;
            const vertexOffset = attribute('instanceData').z;

            const tetId = attribute('tetId').add(tetOffset);
            const vertexIds = attribute('vertexIds').add(vertexOffset).toVar();
            const baryCoords = attribute('tetBaryCoords');

            // Get vertex positions from physics buffer
            const v0 = this.physics.buffers.vertexBuffer.get(vertexIds.x, 'position').xyz.toVar();
            const v1 = this.physics.buffers.vertexBuffer.get(vertexIds.y, 'position').xyz.toVar();
            const v2 = this.physics.buffers.vertexBuffer.get(vertexIds.z, 'position').xyz.toVar();
            const v3 = this.physics.buffers.vertexBuffer.get(vertexIds.w, 'position').xyz.toVar();

            // Get tet quaternion for normal rotation
            const quat = this.physics.buffers.tetBuffer.get(tetId, 'quat');

            // Rotate normal
            const normal = rotateByQuat(attribute('normal'), quat);
            const viewNormal = transformNormalToView(normal).toVar();
            viewNormal.z.assign(viewNormal.z.max(0));
            vNormal.assign(viewNormal);
            vDistance.assign(attribute('position').length());

            // Interpolate position using barycentric coordinates
            const a = v1.sub(v0).mul(baryCoords.x);
            const b = v2.sub(v0).mul(baryCoords.y);
            const c = v3.sub(v0).mul(baryCoords.z);
            const position = a.add(b).add(c).add(v0).toVar();

            return position;
        })();

        this.material = material;
    }

    /**
     * Disposes resources
     */
    dispose() {
        if (this.mesh && this.physics?.object) {
            this.physics.object.remove(this.mesh);
        }
        if (this.geometry) this.geometry.dispose();
        if (this.material) this.material.dispose();
    }
}
