/**
 * Tetrament - Three.js Softbody Simulation Library
 *
 * A comprehensive library for tetrahedralizing geometries and running
 * softbody simulations using WebGPU compute shaders.
 *
 * @module tetrament
 */

// Core simulation
export { SoftbodySimulation } from './core/SoftbodySimulation.js';
export { SoftbodyGeometry } from './core/SoftbodyGeometry.js';
export { SoftbodyInstance } from './core/SoftbodyInstance.js';

// Tetrahedralization
export { Tetrahedralizer } from './tetrahedralize/Tetrahedralizer.js';
export { tetrahedralize, tetrahedralizePoints } from './tetrahedralize/tetrahedralize.js';

// Colliders
export { SphereCollider } from './colliders/SphereCollider.js';
export { BoxCollider } from './colliders/BoxCollider.js';
export { CapsuleCollider } from './colliders/CapsuleCollider.js';
export { PlaneCollider } from './colliders/PlaneCollider.js';
export { MeshCollider } from './colliders/MeshCollider.js';

// Controls
export { DragControl } from './controls/DragControl.js';
export { AnchorControl } from './controls/AnchorControl.js';

// Debug visualizers
export { StrainVisualizer } from './debug/StrainVisualizer.js';
export { TetVisualizer } from './debug/TetVisualizer.js';

// Geometry generators
export { generateTube } from './geometry/TubeGenerator.js';
export { generateSphere, generateIcosphere } from './geometry/SphereGenerator.js';
export { generateBox, generateSimpleBox } from './geometry/BoxGenerator.js';
export { generateTorus, generateTorusKnot, generateCylinder, generateCone } from './geometry/TorusGenerator.js';

// Model processing utilities
export {
    processGeometry,
    processTetGeometry,
    loadModelFromMsh,
    loadModelFromGeometry
} from './geometry/ModelProcessor.js';

// Math utilities
export * from './utils/math.js';
