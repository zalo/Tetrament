/**
 * Strain visualization for softbody debugging
 * Shows compression/tension strain as colors
 * @module tetrament/debug/StrainVisualizer
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    varying,
    vec3,
    vec4,
    float,
    length,
    mix,
    clamp,
    instanceIndex,
    transformNormalToView
} from 'three/tsl';

import { rotateByQuat } from '../core/shaderMath.js';

/**
 * Visualizes strain on softbody surfaces
 */
export class StrainVisualizer {
    /**
     * @param {SoftbodySimulation} simulation - Physics simulation
     * @param {Object} [options] - Options
     * @param {number} [options.maxStrain=0.5] - Maximum strain for color mapping
     * @param {THREE.Color} [options.compressionColor] - Color for compression
     * @param {THREE.Color} [options.neutralColor] - Color for neutral
     * @param {THREE.Color} [options.tensionColor] - Color for tension
     */
    constructor(simulation, options = {}) {
        this.simulation = simulation;
        this.maxStrain = options.maxStrain ?? 0.5;
        this.compressionColor = options.compressionColor ?? new THREE.Color(0x0066ff);
        this.neutralColor = options.neutralColor ?? new THREE.Color(0x00ff00);
        this.tensionColor = options.tensionColor ?? new THREE.Color(0xff0000);

        this.enabled = false;
        this._originalMaterials = new Map();
    }

    /**
     * Creates strain visualization material
     * @param {SoftbodyGeometry} geometry - Geometry to visualize
     * @returns {THREE.Material} Strain material
     */
    createMaterial(geometry) {
        const material = new THREE.MeshBasicNodeMaterial();
        const { tetBuffer, vertexBuffer, restPosesBuffer } = this.simulation.buffers;

        const compressionCol = vec3(
            this.compressionColor.r,
            this.compressionColor.g,
            this.compressionColor.b
        );
        const neutralCol = vec3(
            this.neutralColor.r,
            this.neutralColor.g,
            this.neutralColor.b
        );
        const tensionCol = vec3(
            this.tensionColor.r,
            this.tensionColor.g,
            this.tensionColor.b
        );

        // Varying to pass strain color from vertex to fragment shader
        const vStrainColor = varying(vec3(0), 'v_strainColor');

        // Position node - deforms vertices to follow simulation (same as SoftbodyGeometry)
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

            // Get initial positions for strain calculation
            const i0 = vertexBuffer.get(vertexIds.x, 'initialPosition').xyz.toVar();
            const i1 = vertexBuffer.get(vertexIds.y, 'initialPosition').xyz.toVar();
            const i2 = vertexBuffer.get(vertexIds.z, 'initialPosition').xyz.toVar();
            const i3 = vertexBuffer.get(vertexIds.w, 'initialPosition').xyz.toVar();

            // Calculate current edge lengths
            const e01 = length(v1.sub(v0));
            const e02 = length(v2.sub(v0));
            const e03 = length(v3.sub(v0));
            const e12 = length(v2.sub(v1));
            const e13 = length(v3.sub(v1));
            const e23 = length(v3.sub(v2));

            // Calculate initial edge lengths
            const ie01 = length(i1.sub(i0));
            const ie02 = length(i2.sub(i0));
            const ie03 = length(i3.sub(i0));
            const ie12 = length(i2.sub(i1));
            const ie13 = length(i3.sub(i1));
            const ie23 = length(i3.sub(i2));

            // Calculate strain for each edge
            const s01 = e01.sub(ie01).div(ie01);
            const s02 = e02.sub(ie02).div(ie02);
            const s03 = e03.sub(ie03).div(ie03);
            const s12 = e12.sub(ie12).div(ie12);
            const s13 = e13.sub(ie13).div(ie13);
            const s23 = e23.sub(ie23).div(ie23);

            // Average strain
            const avgStrain = s01.add(s02).add(s03).add(s12).add(s13).add(s23).div(6);

            // Map to color
            const normalizedStrain = clamp(avgStrain.div(this.maxStrain).add(1).mul(0.5).sub(0.5).mul(10.0).add(0.5), -1, 1);

            // Negative = compression (blue), positive = tension (red)
            const color = mix(
                mix(compressionCol, neutralCol, normalizedStrain),
                mix(neutralCol, tensionCol, normalizedStrain),
                normalizedStrain
            );

            // Store strain color in varying for fragment shader
            vStrainColor.assign(color);

            // Interpolate position using barycentric coordinates
            const a = v1.sub(v0).mul(baryCoords.x);
            const b = v2.sub(v0).mul(baryCoords.y);
            const c = v3.sub(v0).mul(baryCoords.z);
            const position = a.add(b).add(c).add(v0).toVar();

            return position;
        })();

        // Color node - use the strain color computed in vertex shader
        material.colorNode = vStrainColor;

        return material;
    }

    /**
     * Enables strain visualization
     */
    enable() {
        if (this.enabled) return;
        this.enabled = true;

        for (const geometry of this.simulation.geometries) {
            // Store original material
            this._originalMaterials.set(geometry, geometry.material);

            // Create and apply strain material
            const strainMaterial = this.createMaterial(geometry);
            geometry.material = strainMaterial;

            // Update mesh
            if (geometry.geometry) {
                const mesh = this.simulation.object.children.find(
                    child => child.geometry === geometry.geometry
                );
                if (mesh) {
                    mesh.material = strainMaterial;
                }
            }
        }
    }

    /**
     * Disables strain visualization
     */
    disable() {
        if (!this.enabled) return;
        this.enabled = false;

        for (const geometry of this.simulation.geometries) {
            const originalMaterial = this._originalMaterials.get(geometry);
            if (originalMaterial) {
                geometry.material = originalMaterial;

                // Update mesh
                if (geometry.geometry) {
                    const mesh = this.simulation.object.children.find(
                        child => child.geometry === geometry.geometry
                    );
                    if (mesh) {
                        mesh.material = originalMaterial;
                    }
                }
            }
        }

        this._originalMaterials.clear();
    }

    /**
     * Toggles strain visualization
     */
    toggle() {
        if (this.enabled) {
            this.disable();
        } else {
            this.enable();
        }
    }

    /**
     * Sets the maximum strain for color mapping
     * @param {number} maxStrain
     */
    setMaxStrain(maxStrain) {
        this.maxStrain = maxStrain;
        if (this.enabled) {
            this.disable();
            this.enable();
        }
    }

    /**
     * Disposes resources
     */
    dispose() {
        this.disable();
    }
}
