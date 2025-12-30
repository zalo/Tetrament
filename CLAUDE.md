# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run build       # Bundle library to dist/tetrament.js
npm run build:min   # Minified bundle with sourcemap
npm run build:all   # Both builds
npm run dev         # Watch mode for development
```

No test runner is configured. Examples can be tested by serving files locally (e.g., `npx serve .`) and opening `/examples/softbody-basic/` or `/examples/tetrahedralization/` in a WebGPU-enabled browser.

## Architecture Overview

Tetrament is a Three.js library for real-time softbody physics using WebGPU compute shaders and FEM (Finite Element Method).

### Core Pipeline

1. **Tetrahedralization** (`lib/tetrahedralize/`): Converts surface meshes to tetrahedral meshes using Bowyer-Watson Delaunay algorithm
   - `Tetrahedralizer.js` - Main class using BVH ray casting for inside/outside testing
   - `tetrahedralize.js` - Convenience functions wrapping the Tetrahedralizer

2. **Simulation Core** (`lib/core/`):
   - `SoftbodySimulation.js` - Main physics simulation with WebGPU compute kernels
   - `SoftbodyGeometry.js` - Manages instanced rendering with TSL (Three.js Shading Language) vertex deformation
   - `SoftbodyInstance.js` - Individual softbody instance with spawn/despawn lifecycle
   - `StructuredArray.js` - Helper for GPU buffer layout with struct-like access
   - `Grid.js` - Spatial hashing grid for tet-tet collision detection
   - `shaderMath.js` - TSL math utilities (quaternions, rotation extraction)

3. **Physics Loop** (GPU compute shaders in SoftbodySimulation):
   - `solveElemPass` - Rotation extraction from covariance matrix, builds spatial grid
   - `solveCollisions` - Tet-tet collision response using spatial grid
   - `applyElemPass` - Vertex integration with Verlet, collider response with friction

### Key Patterns

- **TSL (Three.js Shading Language)**: All compute shaders use TSL from `three/tsl`. Import nodes like `Fn`, `float`, `vec3`, `If`, `Loop` etc.
- **WebGPU Imports**: Use `three/webgpu` for renderer and WebGPU-compatible materials
- **StructuredArray**: Custom buffer abstraction for GPU structs - see `StructuredArray.js` for layout definition syntax
- **Collider Functions**: Return `vec4(normal.xyz, signedDistance)` - negative distance means penetration

### Data Flow

```
BufferGeometry → Tetrahedralizer → Model (tetVerts, tetIds, attachedTets, baryCoords)
                                      ↓
Model → SoftbodyGeometry.addInstance() → SoftbodyInstance
                                              ↓
                                    simulation.bake() → GPU buffers
                                              ↓
                                    instance.spawn() → reset kernels
                                              ↓
                                    simulation.update() → physics loop
```

### Dependencies

- `three` (>=0.182.0) - WebGPU renderer and TSL
- `three-mesh-bvh` - Accelerated raycasting for tetrahedralization inside/outside tests
