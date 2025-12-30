/**
 * Tetrament - Three.js Softbody Simulation Library
 * TypeScript declarations
 */

import * as THREE from 'three';

// ============================================================================
// Core Simulation
// ============================================================================

export interface SimulationConfig {
    stepsPerSecond?: number;
    gravity?: THREE.Vector3;
    damping?: number;
    rotationSteps?: number;
}

export class SoftbodySimulation {
    constructor(renderer: THREE.WebGPURenderer, config?: SimulationConfig);

    object: THREE.Object3D;
    vertices: any[];
    tets: any[];
    geometries: SoftbodyGeometry[];
    objects: SoftbodyInstance[];
    colliders: Function[];
    vertexCount: number;
    tetCount: number;
    initialized: boolean;

    addVertex(objectId: number, x: number, y: number, z: number): any;
    addTet(objectId: number, v0: any, v1: any, v2: any, v3: any): any;
    addGeometry(model: SoftbodyModel, materialClass?: typeof THREE.Material): SoftbodyGeometry;
    addInstance(geometry: SoftbodyGeometry): SoftbodyInstance;
    addCollider(collider: ColliderFunction): void;
    addAnchor(anchor: any): void;
    getPosition(objectId: number): THREE.Vector3;
    bake(): Promise<void>;
    readPositions(): Promise<void>;
    resetObject(
        id: number,
        position: THREE.Vector3,
        quaternion: THREE.Quaternion,
        scale: THREE.Vector3,
        velocity?: THREE.Vector3
    ): Promise<void>;
    onPointerDown(origin: THREE.Vector3, direction: THREE.Vector3, force?: THREE.Vector3): Promise<void>;
    update(deltaTime: number, elapsed?: number): Promise<void>;
    setActiveBodyCount(count: number): Promise<void>;
    dispose(): void;
}

export class SoftbodyGeometry {
    constructor(physics: SoftbodySimulation, model: SoftbodyModel, materialClass: typeof THREE.Material);

    physics: SoftbodySimulation;
    model: SoftbodyModel;
    instances: SoftbodyInstance[];
    geometry: THREE.InstancedBufferGeometry | null;
    material: THREE.Material;

    addInstance(): SoftbodyInstance;
    updateCount(): void;
    bake(): Promise<void>;
    dispose(): void;
}

export class SoftbodyInstance {
    constructor(physics: SoftbodySimulation, geometry: SoftbodyGeometry);

    physics: SoftbodySimulation;
    geometry: SoftbodyGeometry;
    spawned: boolean;
    id: number;
    tetOffset: number;
    vertexOffset: number;

    spawn(
        position: THREE.Vector3,
        quaternion?: THREE.Quaternion,
        scale?: THREE.Vector3,
        velocity?: THREE.Vector3
    ): Promise<void>;
    despawn(): void;
    getPosition(): THREE.Vector3;
    update(deltaTime: number, elapsed: number): Promise<void>;
}

// ============================================================================
// Tetrahedralization
// ============================================================================

export interface TetrahedralizerOptions {
    resolution?: number;
    minQuality?: number;
    verbose?: boolean;
}

export interface TetrahedralizationResult {
    tetVerts: Float32Array;
    tetIds: Uint32Array;
    vertices: THREE.Vector3[];
    tetCount: number;
}

export class Tetrahedralizer {
    constructor(options?: TetrahedralizerOptions);

    resolution: number;
    minQuality: number;
    verbose: boolean;

    tetrahedralize(geometry: THREE.BufferGeometry): TetrahedralizationResult;
    tetrahedralizePoints(points: THREE.Vector3[] | Float32Array): TetrahedralizationResult;
    isInside(point: THREE.Vector3, minDist?: number): boolean;
    dispose(): void;
}

export function tetrahedralize(
    geometry: THREE.BufferGeometry,
    options?: TetrahedralizerOptions
): TetrahedralizationResult;

export function tetrahedralizePoints(
    points: THREE.Vector3[] | Float32Array | number[][],
    options?: TetrahedralizerOptions
): TetrahedralizationResult;

// ============================================================================
// Models
// ============================================================================

export interface SoftbodyModel {
    tetVerts: number[] | Float32Array;
    tetIds: number[] | Uint32Array;
    attachedTets: number[];
    baryCoords: number[];
    positions: number[];
    normals: number[];
    uvs: number[];
    indices: number[];
}

export function processTetGeometry(
    tetVertsRaw: number[] | Float32Array,
    tetIdsRaw: number[] | Uint32Array
): {
    tetVerts: number[];
    tetIds: number[];
    vertices: THREE.Vector3[];
    tets: any[];
};

export function processGeometry(
    geometry: THREE.BufferGeometry,
    tets: any[]
): {
    attachedTets: number[];
    baryCoords: number[];
    positions: number[];
    normals: number[];
    uvs: number[];
    indices: number[];
};

export function loadModelFromMsh(
    mshContent: string,
    surfaceGeometry: THREE.BufferGeometry
): SoftbodyModel;

export function loadModelFromGeometry(
    tetVerts: Float32Array | number[],
    tetIds: Uint32Array | number[],
    surfaceGeometry: THREE.BufferGeometry
): SoftbodyModel;

// ============================================================================
// Geometry Generators
// ============================================================================

export interface TubeOptions {
    radius?: number;
    subdivisions?: number;
}

export function generateTube(segments?: number, options?: TubeOptions): SoftbodyModel;
export function generateRope(length?: number, segmentsPerUnit?: number, options?: TubeOptions): SoftbodyModel;

export interface SphereOptions {
    widthSegments?: number;
    heightSegments?: number;
    resolution?: number;
    minQuality?: number;
}

export function generateSphere(radius?: number, options?: SphereOptions): SoftbodyModel;
export function generateIcosphere(radius?: number, options?: SphereOptions): SoftbodyModel;

export interface BoxOptions {
    widthSegments?: number;
    heightSegments?: number;
    depthSegments?: number;
    resolution?: number;
    minQuality?: number;
}

export function generateBox(
    width?: number,
    height?: number,
    depth?: number,
    options?: BoxOptions
): SoftbodyModel;

export function generateSimpleBox(
    width?: number,
    height?: number,
    depth?: number,
    options?: BoxOptions
): SoftbodyModel;

// ============================================================================
// Colliders
// ============================================================================

export type ColliderFunction = (position: any) => any;

export function PlaneCollider(normal?: THREE.Vector3, distance?: number): ColliderFunction;
export function GroundPlane(height?: number): ColliderFunction;

export function SphereCollider(center: THREE.Vector3, radius: number, inside?: boolean): ColliderFunction;
export function DynamicSphereCollider(radius: number, inside?: boolean): {
    collider: ColliderFunction;
    setPosition(x: THREE.Vector3 | number, y?: number, z?: number): void;
};

export function BoxCollider(
    center: THREE.Vector3,
    halfExtents: THREE.Vector3,
    inside?: boolean
): ColliderFunction;
export function DynamicBoxCollider(halfExtents: THREE.Vector3, inside?: boolean): {
    collider: ColliderFunction;
    setPosition(x: THREE.Vector3 | number, y?: number, z?: number): void;
};

export function CapsuleCollider(pointA: THREE.Vector3, pointB: THREE.Vector3, radius: number): ColliderFunction;
export function VerticalCapsuleCollider(center: THREE.Vector3, height: number, radius: number): ColliderFunction;
export function DynamicCapsuleCollider(axisLength: number, radius: number, axis?: THREE.Vector3): {
    collider: ColliderFunction;
    setPosition(x: THREE.Vector3 | number, y?: number, z?: number): void;
};

export class MeshCollider {
    constructor(geometryOrMesh: THREE.BufferGeometry | THREE.Mesh, options?: { margin?: number });

    margin: number;
    mesh: THREE.Mesh;
    geometry: THREE.BufferGeometry;

    closestPointToPoint(point: THREE.Vector3, target?: THREE.Vector3): any;
    isInside(point: THREE.Vector3): boolean;
    signedDistance(point: THREE.Vector3): {
        distance: number;
        normal: THREE.Vector3;
        closestPoint: THREE.Vector3 | null;
    };
    resolveCollision(point: THREE.Vector3, velocity?: THREE.Vector3): {
        newPosition: THREE.Vector3;
        normal: THREE.Vector3;
        penetration: number;
    } | null;
    updateMatrix(matrix: THREE.Matrix4): void;
    dispose(): void;
}

// ============================================================================
// Controls
// ============================================================================

export interface DragControlOptions {
    force?: number;
    radius?: number;
    button?: 'left' | 'right' | 'middle';
}

export class DragControl {
    constructor(
        simulation: SoftbodySimulation,
        camera: THREE.Camera,
        domElement: HTMLElement,
        options?: DragControlOptions
    );

    simulation: SoftbodySimulation;
    camera: THREE.Camera;
    domElement: HTMLElement;
    force: number;
    radius: number;
    enabled: boolean;
    isDragging: boolean;

    setForce(force: number): void;
    setRadius(radius: number): void;
    enable(): void;
    disable(): void;
    dispose(): void;
}

export interface AnchorDef {
    position: THREE.Vector3;
    radius: number;
    target?: THREE.Object3D;
    strength?: number;
}

export class AnchorControl {
    constructor(simulation: SoftbodySimulation, maxAnchors?: number);

    simulation: SoftbodySimulation;
    maxAnchors: number;
    anchors: any[];
    enabled: boolean;

    initialize(): Promise<void>;
    addAnchor(anchorDef: AnchorDef): number;
    removeAnchor(index: number): void;
    update(): Promise<void>;
    setAnchorPosition(index: number, position: THREE.Vector3): void;
    setAnchorTarget(index: number, target: THREE.Object3D): void;
    setAnchorStrength(index: number, strength: number): void;
    getAnchors(): any[];
    dispose(): void;
}

// ============================================================================
// Debug Visualizers
// ============================================================================

export interface StrainVisualizerOptions {
    maxStrain?: number;
    compressionColor?: THREE.Color;
    neutralColor?: THREE.Color;
    tensionColor?: THREE.Color;
}

export class StrainVisualizer {
    constructor(simulation: SoftbodySimulation, options?: StrainVisualizerOptions);

    simulation: SoftbodySimulation;
    maxStrain: number;
    enabled: boolean;

    enable(): void;
    disable(): void;
    toggle(): void;
    setMaxStrain(maxStrain: number): void;
    dispose(): void;
}

export interface TetVisualizerOptions {
    wireframeColor?: THREE.Color;
    faceColor?: THREE.Color;
    opacity?: number;
    scale?: number;
}

export interface TetVisualizationOptions {
    showWireframe?: boolean;
    showFaces?: boolean;
    colorByQuality?: boolean;
}

export interface TetStatistics {
    vertexCount: number;
    tetCount: number;
    totalVolume: number;
    minQuality: number;
    maxQuality: number;
    avgQuality: number;
}

export class TetVisualizer {
    constructor(options?: TetVisualizerOptions);

    group: THREE.Group;
    wireframeMesh: THREE.LineSegments | null;
    faceMesh: THREE.Mesh | null;

    createVisualization(
        tetVerts: Float32Array | number[],
        tetIds: Uint32Array | number[],
        options?: TetVisualizationOptions
    ): THREE.Group;

    createSurfaceVisualization(
        tetVerts: Float32Array | number[],
        tetIds: Uint32Array | number[],
        options?: TetVisualizationOptions
    ): THREE.Group;

    static getStatistics(
        tetVerts: Float32Array | number[],
        tetIds: Uint32Array | number[]
    ): TetStatistics;

    setVisible(visible: boolean): void;
    setWireframeVisible(visible: boolean): void;
    setFacesVisible(visible: boolean): void;
    dispose(): void;
}

// ============================================================================
// Math Utilities
// ============================================================================

export function getCircumCenter(
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3
): THREE.Vector3;

export function getCircumRadius(
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3
): number;

export function tetQuality(
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3
): number;

export function tetVolume(
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3
): number;

export function getBarycentricCoords(
    point: THREE.Vector3,
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3
): { u: number; v: number; w: number; t: number };

export function getTetCentroid(
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3
): THREE.Vector3;

export const TET_FACES: number[][];
export const TET_EDGES: number[][];

export function randEps(eps?: number): number;
export function clamp(value: number, min: number, max: number): number;
export function lerp(a: number, b: number, t: number): number;
export function smoothstep(edge0: number, edge1: number, x: number): number;
