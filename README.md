# Tetrament

A comprehensive Three.js library for tetrahedralizing geometries and running real-time softbody simulations using WebGPU compute shaders.

### [Tetrahedralization Example](https://zalo.github.io/Tetrament/examples/tetrahedralization/)

### [Softbody Simulation Example](https://zalo.github.io/Tetrament/examples/softbody-basic/)

## Features

- **Tetrahedralization**: Convert any Three.js geometry into a tetrahedral mesh using Delaunay tetrahedralization (Bowyer-Watson algorithm)
- **Real-time Softbody Physics**: GPU-accelerated FEM (Finite Element Method) physics simulation
- **WebGPU Compute Shaders**: Massively parallel physics computation for high performance
- **SDF Colliders**: Sphere, box, capsule, plane, and mesh colliders
- **Interactive Controls**: Mouse dragging and vertex anchoring
- **Debug Visualization**: Strain visualization and tetrahedral mesh inspection
- **Geometry Generators**: Pre-built tube, sphere, box, torus, cylinder, and cone generators

## Installation

```bash
npm install tetrament three three-mesh-bvh
```

## Requirements

- Three.js 0.183.0 or higher (with WebGPU support)
- three-mesh-bvh 0.7.0 or higher
- WebGPU-enabled browser (Chrome 113+, Edge 113+)

## Quick Start

### Tetrahedralization Only

```javascript
import * as THREE from 'three';
import { tetrahedralize, TetVisualizer } from 'tetrament';

// Create a geometry
const geometry = new THREE.SphereGeometry(1, 16, 12);

// Tetrahedralize it
const result = tetrahedralize(geometry, {
    resolution: 10,    // Interior sampling resolution
    minQuality: 0.001  // Minimum tet quality
});

console.log(`Created ${result.tetCount} tetrahedra`);

// Visualize the result
const visualizer = new TetVisualizer();
const tetMesh = visualizer.createVisualization(result.tetVerts, result.tetIds, {
    showWireframe: true,
    showFaces: true,
    colorByQuality: true
});
scene.add(tetMesh);
```

### Softbody Simulation

```javascript
import * as THREE from 'three/webgpu';
import {
    SoftbodySimulation,
    generateTube,
    PlaneCollider,
    DragControl
} from 'tetrament';

// Create WebGPU renderer
const renderer = new THREE.WebGPURenderer();
await renderer.init();

// Create simulation
const simulation = new SoftbodySimulation(renderer, {
    stepsPerSecond: 180,
    gravity: new THREE.Vector3(0, -19.62, 0)
});

// Add ground collider
simulation.addCollider(PlaneCollider(new THREE.Vector3(0, 1, 0), 0));

// Generate a tube model
const tubeModel = generateTube(15, { radius: 0.1 });

// Add geometry and create instances
const geometry = simulation.addGeometry(tubeModel);
const instance = simulation.addInstance(geometry);

// Add to scene
scene.add(simulation.object);

// Initialize simulation
await simulation.bake();

// Spawn the softbody
await instance.spawn(
    new THREE.Vector3(0, 3, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(1, 1, 1)
);

// Enable mouse interaction
const dragControl = new DragControl(simulation, camera, renderer.domElement);

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    simulation.update(deltaTime);
    renderer.render(scene, camera);
}
```

## API Overview

### Tetrahedralization
- `tetrahedralize(geometry, options)` - Tetrahedralize a BufferGeometry
- `tetrahedralizePoints(points, options)` - Tetrahedralize a point cloud
- `Tetrahedralizer` class - Full control over tetrahedralization

### Simulation
- `SoftbodySimulation` - Main physics simulation
- `SoftbodyGeometry` - Manages softbody rendering
- `SoftbodyInstance` - Individual softbody instance

### Colliders
- `PlaneCollider` - Infinite plane
- `SphereCollider` - Sphere (static)
- `BoxCollider` - Axis-aligned box
- `CapsuleCollider` - Capsule
- `MeshCollider` - Complex mesh shapes (CPU-based)

### Geometry Generators
- `generateTube(segments, options)` - Tube/capsule shapes
- `generateSphere(radius, options)` - Spheres
- `generateIcosphere(radius, options)` - Icosphere variant
- `generateBox(w, h, d, options)` - Boxes
- `generateTorus(options)` - Torus shapes
- `generateTorusKnot(options)` - Torus knots
- `generateCylinder(options)` - Cylinders
- `generateCone(options)` - Cones

### Model Processing
- `processGeometry(geometry)` - Process BufferGeometry for softbody use
- `processTetGeometry(tetVerts, tetIds, geometry)` - Process pre-tetrahedralized geometry
- `loadModelFromMsh(mshData)` - Load from MSH format
- `loadModelFromGeometry(geometry, options)` - Load from BufferGeometry with tetrahedralization

### Controls
- `DragControl` - Mouse interaction
- `AnchorControl` - Pin vertices to transforms

### Debug
- `TetVisualizer` - Visualize tetrahedral mesh
- `StrainVisualizer` - Show compression/tension

## Examples

- `/examples/tetrahedralization/` - Interactive tetrahedralization demo
- `/examples/softbody-basic/` - Basic softbody simulation

## Development

```bash
# Install dependencies
npm install

# Build library
npm run build

# Build with watch mode
npm run dev
```

## Credits

The softbody simulation is based on the WebGL implementation in [TetSim](https://github.com/zalo/TetSim). Reimplemented in three.js TSL with collision detection by [holtsetio](https://github.com/holtsetio/softbodies).

Tetrahedralization algorithm based on [Ten Minute Physics](https://www.youtube.com/channel/UCTG_vrRdKYfrpqCv_WV4eyA) by Matthias Mueller.

## License

MIT
