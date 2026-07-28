/**
 * Viscoelastic clay — a GPU particle simulation that coexists with the
 * tetrahedral softbody solver.
 *
 * Model: a big pile of balls solved with position-based distance constraints.
 * Each pair of balls closer than `activationRadius` is constrained toward a
 * `restDistance`. Because the activation shell is slightly LARGER than the rest
 * distance, balls that drift a little apart are pulled back together — a sticky,
 * cohesive behaviour that reads as viscoelastic clay. Balls closer than the rest
 * distance are pushed apart (collision). Verlet integration + damping + XSPH
 * viscosity supply the viscous part; the springy constraints supply the elastic
 * part. Neighbour search uses the same atomic linked-list grid as the softbody
 * self-collision (see {@link Grid}).
 *
 * Two-way coupling: each substep the clay reads the softbody's *tet* spatial
 * grid (populated by solveElemPass) and collides against tets as spheres —
 * pushing itself out and nudging the tet's vertices back.
 *
 * @module tetrament/core/ClaySimulation
 */

import * as THREE from 'three/webgpu';
import {
    Fn, instancedArray, instanceIndex, uniform,
    int, float, vec3, ivec3, min,
    If, Loop, atomicFunc, positionLocal,
} from 'three/tsl';
import { Grid } from './Grid.js';

export class ClaySimulation {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {Object} [config]
     * @param {number} [config.count=4500] - Particle count
     * @param {number} [config.particleRadius=0.07] - Ball collision radius (restDistance = 2r)
     * @param {number} [config.stickiness=1.5] - activationRadius / restDistance (>1 = sticky)
     * @param {number} [config.stiffness=0.3] - Constraint stiffness (PBD fraction, 0..1)
     * @param {number} [config.viscosity=0.2] - XSPH velocity smoothing (0..1)
     * @param {number} [config.damping=0.9] - Velocity retention
     * @param {number} [config.renderRadius] - Sphere render radius (defaults to particleRadius*1.05)
     * @param {THREE.Vector3} [config.gravity]
     * @param {number} [config.color=0xc98a5a]
     */
    constructor(renderer, config = {}) {
        this.renderer = renderer;
        const particleRadius = config.particleRadius ?? 0.07;
        const restDistance = particleRadius * 2;
        const stickiness = config.stickiness ?? 1.7;
        const activationRadius = restDistance * stickiness;

        this.config = {
            count: config.count ?? 4500,
            particleRadius,
            restDistance,
            activationRadius,
            stickiness,
            stiffness: config.stiffness ?? 0.5,
            iterations: config.iterations ?? 2, // constraint solve iterations (incompressibility)
            viscosity: config.viscosity ?? 0.3,
            damping: config.damping ?? 0.98, // low bulk drag; viscosity handles the viscous feel
            // Cap per-substep travel below the activation radius so fast balls can't
            // outrun the sticky shell and escape cohesion.
            maxSpeed: config.maxSpeed ?? (activationRadius * 0.6),
            renderRadius: config.renderRadius ?? particleRadius * 1.05,
            gravity: config.gravity ?? new THREE.Vector3(0, -19.62, 0),
            color: config.color ?? 0xc98a5a,
        };

        const count = this.config.count;
        this.count = count;

        // Particle buffers.
        this.pos = instancedArray(count, 'vec3');
        this.prev = instancedArray(count, 'vec3');
        this.disp = instancedArray(count, 'vec3'); // constraint displacement (race-free double buffer)
        this.next = instancedArray(count, 'int');  // grid linked-list "next" pointer

        // Neighbour grid: cell size = activation radius so the 3x3x3 walk covers it.
        this.grid = new Grid(activationRadius, 'basic');

        this.uniforms = {
            dt: uniform(1 / 120, 'float'),
            gravity: uniform(this.config.gravity, 'vec3'),
            restDist: uniform(restDistance, 'float'),
            activation: uniform(activationRadius, 'float'),
            stiffness: uniform(this.config.stiffness, 'float'),
            viscosity: uniform(this.config.viscosity, 'float'),
            damping: uniform(this.config.damping, 'float'),
            maxSpeed: uniform(this.config.maxSpeed, 'float'),
            maxDisp: uniform(restDistance * 0.5, 'float'),
            pRadius: uniform(particleRadius, 'float'),
            spawnCenter: uniform(new THREE.Vector3(0, 3, 0), 'vec3'),
            spawnSpacing: uniform(restDistance * 1.02, 'float'),
            spawnSide: uniform(Math.ceil(Math.cbrt(count)), 'float'),
            coupleStrength: uniform(0.6, 'float'),
        };

        this.colliders = [];
        this._sim = null;
        this.kernels = {};
        this.object = null;
        this._built = false;
    }

    setColliders(colliders) { this.colliders = colliders.slice(); return this; }

    coupleTo(simulation, opts = {}) {
        this._sim = simulation;
        this.uniforms.coupleStrength.value = opts.strength ?? 0.6;
        return this;
    }

    bake() {
        if (this._built) return;
        this._buildReset();
        this._buildIntegrate();
        this._buildConstrain();
        this._buildApplyDisp();
        this._buildViscosity();
        this._buildCollide();
        this._buildRenderObject();
        this._built = true;
    }

    reset(center) {
        if (center) this.uniforms.spawnCenter.value.copy(center);
        this.renderer.compute(this.kernels.reset);
    }

    /** One fixed substep (registered via simulation.onSubStep for lockstep). */
    step(renderer, dt) {
        this.uniforms.dt.value = dt;
        this.grid.clearBuffer(renderer);
        renderer.compute(this.kernels.integrate);  // predict + insert into grid
        // Iterate the distance-constraint solve for incompressibility/shape.
        for (let i = 0; i < this.config.iterations; i++) {
            renderer.compute(this.kernels.constrain); // distance constraints -> disp
            renderer.compute(this.kernels.applyDisp);  // pos += disp
        }
        renderer.compute(this.kernels.viscosity);    // XSPH velocity smoothing -> prev
        renderer.compute(this.kernels.collide);       // world colliders + tet coupling
    }

    // ---- kernels ----------------------------------------------------------

    _buildReset() {
        const { spawnCenter, spawnSpacing, spawnSide } = this.uniforms;
        this.kernels.reset = Fn(() => {
            const i = float(instanceIndex);
            const side = spawnSide;
            const ix = i.mod(side);
            const iy = i.div(side).floor().mod(side);
            const iz = i.div(side.mul(side)).floor();
            const half = side.mul(0.5);
            const local = vec3(ix.sub(half), iy.sub(half), iz.sub(half)).mul(spawnSpacing);
            const jitter = vec3(i.mul(0.137).sin(), i.mul(0.311).sin(), i.mul(0.529).sin()).mul(spawnSpacing.mul(0.1));
            const p = spawnCenter.add(local).add(jitter);
            this.pos.element(instanceIndex).assign(p);
            this.prev.element(instanceIndex).assign(p);
            this.next.element(instanceIndex).assign(int(-1));
        })().compute(this.count);
    }

    _buildIntegrate() {
        const { dt, gravity, damping, maxSpeed } = this.uniforms;
        this.kernels.integrate = Fn(() => {
            this.grid.setAtomic(true);
            const pos = this.pos.element(instanceIndex).toVar();
            const prev = this.prev.element(instanceIndex).toVar();

            const vel = pos.sub(prev).mul(damping).toVar();
            const speed = vel.length().toVar();
            vel.assign(vel.div(speed.max(1e-6)).mul(min(speed, maxSpeed)));
            const newPos = pos.add(vel).add(gravity.mul(dt).mul(dt)).toVar();

            this.prev.element(instanceIndex).assign(pos);
            this.pos.element(instanceIndex).assign(newPos);

            const cell = this.grid.getElement(newPos);
            this.next.element(instanceIndex).assign(atomicFunc('atomicExchange', cell, int(instanceIndex)));
        })().compute(this.count);
    }

    _buildConstrain() {
        const { restDist, activation, stiffness, maxDisp } = this.uniforms;
        this.kernels.constrain = Fn(() => {
            this.grid.setAtomic(false);
            const pos = this.pos.element(instanceIndex).toVar();
            const cellIndex = ivec3(pos.div(this.grid.cellsize).floor()).sub(1).toConst('cellIndex');
            const dx = vec3(0).toVar();

            Loop({ start: 0, end: 3, type: 'int', name: 'gx', condition: '<' }, ({ gx }) => {
                Loop({ start: 0, end: 3, type: 'int', name: 'gy', condition: '<' }, ({ gy }) => {
                    Loop({ start: 0, end: 3, type: 'int', name: 'gz', condition: '<' }, ({ gz }) => {
                        const cellX = cellIndex.add(ivec3(gx, gy, gz)).toConst();
                        const ptr = this.grid.getElementFromIndex(cellX).toVar('ptr');
                        Loop(ptr.notEqual(int(-1)), () => {
                            If(ptr.notEqual(int(instanceIndex)), () => {
                                const other = this.pos.element(ptr).toVar();
                                const delta = pos.sub(other).toVar();
                                const d = delta.length().max(1e-5).toVar();
                                If(d.lessThan(activation), () => {
                                    // Distance constraint toward restDist. d>rest -> pull together
                                    // (sticky cohesion), d<rest -> push apart (collision). Half
                                    // correction; neighbour applies its own half. Fades to 0 at the
                                    // activation shell so the sticky pull releases smoothly.
                                    const n = delta.div(d);
                                    const w = float(1.0).sub(d.div(activation)).toVar();
                                    const c = d.sub(restDist).mul(stiffness).mul(0.5).mul(w.add(0.001));
                                    dx.subAssign(n.mul(c));
                                });
                            });
                            ptr.assign(this.next.element(ptr));
                        });
                    });
                });
            });

            const len = dx.length().toVar();
            dx.assign(dx.div(len.max(1e-6)).mul(min(len, maxDisp)));
            this.disp.element(instanceIndex).assign(dx);
        })().compute(this.count);
    }

    _buildApplyDisp() {
        this.kernels.applyDisp = Fn(() => {
            this.pos.element(instanceIndex).addAssign(this.disp.element(instanceIndex));
        })().compute(this.count);
    }

    _buildViscosity() {
        const { activation, viscosity } = this.uniforms;
        this.kernels.viscosity = Fn(() => {
            this.grid.setAtomic(false);
            const pos = this.pos.element(instanceIndex).toVar();
            const prev = this.prev.element(instanceIndex).toVar();
            const vel = pos.sub(prev).toVar();
            const cellIndex = ivec3(pos.div(this.grid.cellsize).floor()).sub(1).toConst('cellIndex');
            const velCorr = vec3(0).toVar();
            const wsum = float(0).toVar();

            Loop({ start: 0, end: 3, type: 'int', name: 'gx', condition: '<' }, ({ gx }) => {
                Loop({ start: 0, end: 3, type: 'int', name: 'gy', condition: '<' }, ({ gy }) => {
                    Loop({ start: 0, end: 3, type: 'int', name: 'gz', condition: '<' }, ({ gz }) => {
                        const cellX = cellIndex.add(ivec3(gx, gy, gz)).toConst();
                        const ptr = this.grid.getElementFromIndex(cellX).toVar('ptr');
                        Loop(ptr.notEqual(int(-1)), () => {
                            If(ptr.notEqual(int(instanceIndex)), () => {
                                const other = this.pos.element(ptr).toVar();
                                const w = float(1.0).sub(pos.distance(other).div(activation)).toVar();
                                If(w.greaterThan(0.0), () => {
                                    const otherVel = other.sub(this.prev.element(ptr));
                                    velCorr.addAssign(otherVel.sub(vel).mul(w));
                                    wsum.addAssign(w);
                                });
                            });
                            ptr.assign(this.next.element(ptr));
                        });
                    });
                });
            });

            // XSPH: nudge velocity toward the weighted-average neighbour velocity.
            this.prev.element(instanceIndex).assign(prev.sub(velCorr.div(wsum.max(1.0)).mul(viscosity)));
        })().compute(this.count);
    }

    _buildCollide() {
        const { pRadius, coupleStrength } = this.uniforms;
        const sim = this._sim;

        this.kernels.collide = Fn(() => {
            const pos = this.pos.element(instanceIndex).toVar();
            const prev = this.prev.element(instanceIndex).toVar();

            // --- World colliders (shared analytic + SDF + ground) ---
            this.colliders.forEach((collider) => {
                const res = collider(pos);
                const penetration = res.w.min(0).negate().toVar();
                const normal = res.xyz;
                If(penetration.greaterThan(0.0), () => {
                    pos.addAssign(normal.mul(penetration));
                    const v = pos.sub(prev).toVar();
                    const vn = v.dot(normal).toVar();
                    const vt = v.sub(normal.mul(vn)).toVar();
                    prev.assign(pos.sub(vt.mul(0.7)));
                });
            });

            // --- Two-way coupling against the softbody tet grid ---
            if (sim) {
                sim.grid.setAtomic(false);
                const cellIndex = ivec3(pos.div(sim.grid.cellsize).floor()).sub(1).toConst('cCell');
                Loop({ start: 0, end: 3, type: 'int', name: 'tx', condition: '<' }, ({ tx }) => {
                    Loop({ start: 0, end: 3, type: 'int', name: 'ty', condition: '<' }, ({ ty }) => {
                        Loop({ start: 0, end: 3, type: 'int', name: 'tz', condition: '<' }, ({ tz }) => {
                            const cellX = cellIndex.add(ivec3(tx, ty, tz)).toConst();
                            const tetPtr = sim.grid.getElementFromIndex(cellX).toVar('tetPtr');
                            Loop(tetPtr.notEqual(int(-1)), () => {
                                const objectId = sim.buffers.tetBuffer.get(tetPtr, 'objectId').toVar();
                                const active = sim.buffers.objectBuffer.get(objectId, 'size');
                                If(active.greaterThanEqual(0.0001), () => {
                                    const centroid = sim.buffers.tetBuffer.get(tetPtr, 'centroid').toVar();
                                    const tetR = sim.buffers.tetBuffer.get(tetPtr, 'radius').toVar();
                                    const d = pos.sub(centroid).toVar();
                                    const dist = d.length().max(1e-5).toVar();
                                    const pen = tetR.add(pRadius).sub(dist).toVar();
                                    If(pen.greaterThan(0.0), () => {
                                        const n = d.div(dist).toVar();
                                        pos.addAssign(n.mul(pen).mul(0.5));
                                        const vids = sim.buffers.tetBuffer.get(tetPtr, 'vertexIds').toVar();
                                        const push = n.mul(pen).mul(coupleStrength).mul(0.25).toVar();
                                        const applyToVertex = (vid) => {
                                            const vp = sim.buffers.vertexBuffer.get(vid, 'position').toVar();
                                            const vpp = sim.buffers.vertexBuffer.get(vid, 'prevPosition').toVar();
                                            vp.subAssign(push);
                                            vpp.subAssign(push.mul(0.5));
                                            sim.buffers.vertexBuffer.get(vid, 'position').assign(vp);
                                            sim.buffers.vertexBuffer.get(vid, 'prevPosition').assign(vpp);
                                        };
                                        applyToVertex(vids.x);
                                        applyToVertex(vids.y);
                                        applyToVertex(vids.z);
                                        applyToVertex(vids.w);
                                    });
                                });
                                tetPtr.assign(sim.buffers.tetBuffer.get(tetPtr, 'nextTet'));
                            });
                        });
                    });
                });
            }

            this.pos.element(instanceIndex).assign(pos);
            this.prev.element(instanceIndex).assign(prev);
        })().compute(this.count);
    }

    _buildRenderObject() {
        const geo = new THREE.IcosahedronGeometry(this.config.renderRadius, 1);
        const material = new THREE.MeshStandardNodeMaterial({
            color: new THREE.Color(this.config.color),
            roughness: 0.8,
            metalness: 0.0,
        });
        material.positionNode = positionLocal.add(this.pos.element(instanceIndex));
        const mesh = new THREE.InstancedMesh(geo, material, this.count);
        const identity = new THREE.Matrix4();
        for (let i = 0; i < this.count; i++) mesh.setMatrixAt(i, identity);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        this.object = mesh;
        this._material = material;
        this._geo = geo;
    }

    dispose() {
        Object.values(this.kernels).forEach((k) => k?.dispose?.());
        this.grid?.dispose();
        this._geo?.dispose();
        this._material?.dispose();
    }
}
