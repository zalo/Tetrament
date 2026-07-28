import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
    SoftbodySimulation,
    ClaySimulation,
    PlaneCollider,
    BoxCollider,
    DragControl,
} from '../../../dist/tetrament.js';
import { BG_COLOR, SHAPES, addLighting, addGround, styleBody } from '../lib/env.js';

export function createClayScene() {
    const scene = new THREE.Scene();
    scene.background = BG_COLOR.clone();
    scene.fog = new THREE.Fog(BG_COLOR, 18, 44);

    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
    camera.position.set(0, 5.5, 10);

    let controls, sim, clay, drag, statsRef, keyHandler, unhook;
    const bodies = [];

    const params = {
        gravity: -16,
        stickiness: 1.5,
        stiffness: 0.3,
        viscosity: 0.2,
        coupling: 0.6,
    };

    // Containment: a box "bin" keeps clay and bodies pooled together.
    const BIN = { center: new THREE.Vector3(0, 3.2, 0), half: new THREE.Vector3(3.2, 3.2, 3.2) };

    async function enter(ctx) {
        statsRef = ctx.setStats;
        controls = new OrbitControls(camera, ctx.renderer.domElement);
        controls.enableDamping = true;
        controls.target.set(0, 1.4, 0);
        controls.maxPolarAngle = Math.PI * 0.495;
        controls.minDistance = 3;
        controls.maxDistance = 26;

        addLighting(scene);
        addGround(scene);

        // Shared world colliders (reused by BOTH the softbody solver and the clay).
        const ground = PlaneCollider(new THREE.Vector3(0, 1, 0), 0);
        const bin = BoxCollider(BIN.center, BIN.half, true); // inside = keep contents within

        ctx.setStatus('Creating softbody solver…');
        sim = new SoftbodySimulation(ctx.renderer, {
            stepsPerSecond: 120,
            gravity: new THREE.Vector3(0, params.gravity, 0),
            friction: 0.85,
            damping: 0.999,
        });
        sim.addCollider(ground);
        sim.addCollider(bin);
        scene.add(sim.object);

        // A handful of tetrahedral bodies to coexist with the clay.
        const geomA = styleBody(sim.addGeometry(SHAPES.sphere.make()), SHAPES.sphere.color);
        const geomB = styleBody(sim.addGeometry(SHAPES.box.make()), SHAPES.box.color);
        const geomC = styleBody(sim.addGeometry(SHAPES.gem.make()), SHAPES.gem.color);
        const seed = [geomA, geomA, geomB, geomC, geomC];
        for (const g of seed) bodies.push(sim.addInstance(g));

        ctx.setStatus('Compiling GPU kernels…');
        await sim.bake();
        for (let i = 0; i < bodies.length; i++) {
            await bodies[i].spawn(
                new THREE.Vector3((i - 2) * 1.1, 4.5 + i * 0.4, (Math.random() - 0.5) * 1.5),
                new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3)),
                new THREE.Vector3(1, 1, 1)
            );
        }

        // Clay particle system, coupled to the softbody via its tet grid.
        ctx.setStatus('Baking clay particles…');
        clay = new ClaySimulation(ctx.renderer, {
            count: 4000,
            particleRadius: 0.07,
            stickiness: params.stickiness,
            stiffness: params.stiffness,
            viscosity: params.viscosity,
            gravity: new THREE.Vector3(0, params.gravity, 0),
            color: 0xc98a5a,
        });
        clay.setColliders([ground, bin]);   // reuse the very same collider fns
        clay.coupleTo(sim, { strength: params.coupling });
        clay.bake();
        clay.reset(new THREE.Vector3(0, 4.2, 0));
        scene.add(clay.object);

        // Step clay in lockstep with each softbody substep (sees fresh tet grid).
        unhook = sim.onSubStep((r, dt) => clay.step(r, dt));

        drag = new DragControl(sim, camera, ctx.renderer.domElement, {
            strength: 0.4, maxDistance: 0.14, button: 'left', scene, orbitControls: controls,
        });

        buildGUI(ctx.gui);

        keyHandler = (e) => {
            if (e.code === 'Space' && e.target === document.body) {
                e.preventDefault();
                clay.reset(new THREE.Vector3((Math.random() - 0.5) * 2, 5, (Math.random() - 0.5) * 2));
            }
        };
        window.addEventListener('keydown', keyHandler);
    }

    function buildGUI(gui) {
        const c = gui.addFolder('Clay');
        c.add(params, 'stickiness', 1.0, 2.2, 0.05).name('Stickiness').onChange((v) => clay.uniforms.activation.value = clay.config.restDistance * v);
        c.add(params, 'stiffness', 0.05, 0.8, 0.01).name('Stiffness').onChange((v) => clay.uniforms.stiffness.value = v);
        c.add(params, 'viscosity', 0, 0.8, 0.01).name('Viscosity').onChange((v) => clay.uniforms.viscosity.value = v);
        c.add(params, 'coupling', 0, 1.5, 0.05).name('Coupling ↔ bodies').onChange((v) => clay.uniforms.coupleStrength.value = v);
        c.add({ drop: () => clay.reset(new THREE.Vector3((Math.random() - 0.5) * 2, 5, (Math.random() - 0.5) * 2)) }, 'drop').name('▶ Drop clay (Space)');

        const w = gui.addFolder('World');
        w.add(params, 'gravity', -30, 0, 0.5).name('Gravity').onChange((v) => {
            sim.config.gravity.y = v; sim.uniforms.gravity.value.y = v;
            clay.uniforms.gravity.value.y = v;
        });
    }

    async function update(dt, t, fps) {
        await sim.update(dt, t); // clay steps inside via onSubStep
        drag._updateVisualHelpers();
        statsRef?.(`Bodies <b>${bodies.length}</b> · Clay <b>${clay.count}</b>\nTets <b>${sim.tetCount}</b> · FPS <b>${fps}</b>`);
    }

    function dispose() {
        window.removeEventListener('keydown', keyHandler);
        try { unhook?.(); } catch (e) {}
        try { drag?.dispose(); } catch (e) {}
        try { clay?.dispose(); } catch (e) {}
        if (clay?.object) scene.remove(clay.object);
        try { sim?.dispose(); } catch (e) {}
        if (sim) scene.remove(sim.object);
        controls?.dispose();
        scene.traverse((o) => { if (o.geometry) o.geometry.dispose?.(); });
    }

    return { key: 'clay', scene, camera, get controls() { return controls; }, enter, update, dispose };
}
