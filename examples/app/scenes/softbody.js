import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
    SoftbodySimulation,
    PlaneCollider,
    SphereCollider,
    SDFCollider,
    DragControl,
    StrainVisualizer,
    DynamicTetVisualizer,
    CollisionSphereVisualizer,
} from '../../../dist/tetrament.js';
import { BG_COLOR, SHAPES, addLighting, addGround, styleBody, scatter, makeObstacles } from '../lib/env.js';

export function createSoftbodyScene() {
    const scene = new THREE.Scene();
    scene.background = BG_COLOR.clone();
    scene.fog = new THREE.Fog(BG_COLOR, 18, 44);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(0, 5.5, 11);

    let controls, sim, drag, strainViz, tetViz, sphereViz;
    let keyHandler, statsRef = null;
    const bodies = []; // { instance, shape }
    const geomCache = {};
    const obstacleMeshes = [];

    const params = {
        stepsPerSecond: 180,
        gravity: -19.62,
        friction: 0.9,
        shape: 'tube',
        count: 3,
        showStrain: false,
        showTets: false,
        showSpheres: false,
    };

    async function enter(ctx) {
        statsRef = ctx.setStats;
        controls = new OrbitControls(camera, ctx.renderer.domElement);
        controls.enableDamping = true;
        controls.target.set(0, 1.2, 0);
        controls.maxPolarAngle = Math.PI * 0.495;
        controls.minDistance = 3;
        controls.maxDistance = 30;

        addLighting(scene);
        addGround(scene);

        ctx.setStatus('Creating physics simulation…');
        sim = new SoftbodySimulation(ctx.renderer, {
            stepsPerSecond: params.stepsPerSecond,
            gravity: new THREE.Vector3(0, params.gravity, 0),
            friction: params.friction,
            damping: 0.999,
        });
        sim.addCollider(PlaneCollider(new THREE.Vector3(0, 1, 0), 0));
        sim.addCollider(SphereCollider(new THREE.Vector3(0, 1, 0), 6, true)); // invisible bowl

        // Static mesh colliders: bake each obstacle mesh into an SDF collider
        // (three-mesh-bvh) and add a matching visible mesh.
        ctx.setStatus('Baking mesh SDF colliders…');
        for (const ob of makeObstacles()) {
            const geo = ob.geometry();
            geo.translate(ob.position.x, ob.position.y, ob.position.z); // bake in world space
            sim.addCollider(SDFCollider(geo, { resolution: 32, padding: 0.3, margin: 0.02 }));

            const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
                color: ob.color, roughness: 0.35, metalness: 0.35,
            }));
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            scene.add(mesh);
            obstacleMeshes.push(mesh);
        }

        scene.add(sim.object);

        // Initial population.
        const initial = [
            ['tube', 78], ['sphere', 5], ['box', 4], ['gem', 3], ['star', 3], ['torus', 3],
        ];
        ctx.setStatus('Tetrahedralizing shapes…');
        for (const [shape] of initial) ensureGeometry(shape);

        for (const [shape, n] of initial) {
            for (let i = 0; i < n; i++) {
                bodies.push({ instance: sim.addInstance(geomCache[shape]), shape });
            }
        }

        ctx.setStatus('Compiling GPU kernels…');
        await sim.bake();

        ctx.setStatus('Spawning bodies…');
        for (let i = 0; i < bodies.length; i++) {
            await bodies[i].instance.spawn(
                scatter(i, bodies.length, 2.4, 3.0),
                new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3)),
                new THREE.Vector3(1, 1, 1)
            );
        }

        drag = new DragControl(sim, camera, ctx.renderer.domElement, {
            strength: 0.35, maxDistance: 0.12, button: 'left',
            scene, orbitControls: controls,
        });
        strainViz = new StrainVisualizer(sim, { maxStrain: 0.3 });
        tetViz = new DynamicTetVisualizer(sim, { scale: 0.85 });
        sphereViz = new CollisionSphereVisualizer(sim, { opacity: 0.28 });

        buildGUI(ctx.gui);

        keyHandler = (e) => {
            if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); spawnBodies(); }
        };
        window.addEventListener('keydown', keyHandler);
    }

    function ensureGeometry(shape) {
        if (geomCache[shape]) return false;
        const g = sim.addGeometry(SHAPES[shape].make());
        styleBody(g, SHAPES[shape].color);
        geomCache[shape] = g;
        return true;
    }

    async function refreshViz() {
        if (strainViz.enabled) { strainViz.disable(); strainViz.enable(); }
        if (tetViz.enabled) { tetViz.disable(); await tetViz.enable(); }
        if (sphereViz.enabled) { sphereViz.disable(); await sphereViz.enable(); }
    }

    async function spawnBodies() {
        const needBake = ensureGeometry(params.shape);
        const fresh = [];
        for (let i = 0; i < params.count; i++) {
            const inst = sim.addInstance(geomCache[params.shape]);
            bodies.push({ instance: inst, shape: params.shape });
            fresh.push(inst);
        }
        await sim.bake();
        await refreshViz();
        for (let i = 0; i < fresh.length; i++) {
            await fresh[i].spawn(
                new THREE.Vector3((Math.random() - 0.5) * 3, 4 + i * 0.5, (Math.random() - 0.5) * 3),
                new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)),
                new THREE.Vector3(1, 1, 1)
            );
        }
    }

    function buildGUI(gui) {
        const sf = gui.addFolder('Simulation');
        sf.add(params, 'stepsPerSecond', 60, 360, 10).name('Steps / sec').onChange((v) => sim.config.stepsPerSecond = v);
        sf.add(params, 'gravity', -40, 0, 0.1).name('Gravity').onChange((v) => { sim.config.gravity.y = v; sim.uniforms.gravity.value.y = v; });
        sf.add(params, 'friction', 0, 1, 0.01).name('Friction').onChange((v) => { sim.config.friction = v; sim.uniforms.friction.value = v; });

        const spawn = gui.addFolder('Spawn');
        spawn.add(params, 'shape', Object.fromEntries(Object.entries(SHAPES).map(([k, v]) => [v.label, k]))).name('Shape');
        spawn.add(params, 'count', 1, 8, 1).name('Count');
        spawn.add({ go: () => spawnBodies() }, 'go').name('▶ Spawn (Space)');

        const dbg = gui.addFolder('Debug');
        dbg.add(params, 'showStrain').name('Strain colors').onChange((v) => v ? strainViz.enable() : strainViz.disable());
        dbg.add(params, 'showTets').name('Tetrahedra').onChange(async (v) => v ? await tetViz.enable() : tetViz.disable());
        dbg.add(params, 'showSpheres').name('Collision spheres').onChange(async (v) => v ? await sphereViz.enable() : sphereViz.disable());
    }

    async function update(dt, t, fps) {
        await sim.update(dt, t);
        drag._updateVisualHelpers();
        statsRef?.(`Bodies <b>${bodies.length}</b> · Verts <b>${sim.vertexCount}</b> · Tets <b>${sim.tetCount}</b>\nFPS <b>${fps}</b>`);
    }

    function onResize() {}

    function dispose() {
        window.removeEventListener('keydown', keyHandler);
        try { drag?.dispose(); } catch (e) {}
        try { strainViz?.dispose?.(); tetViz?.dispose?.(); sphereViz?.dispose?.(); } catch (e) {}
        try { (sim?.colliders || []).forEach((c) => c.texture?.dispose?.()); } catch (e) {}
        try { sim?.dispose(); } catch (e) {}
        if (sim) scene.remove(sim.object);
        for (const m of obstacleMeshes) { m.material?.dispose?.(); }
        controls?.dispose();
        scene.traverse((o) => { if (o.geometry) o.geometry.dispose?.(); });
    }

    return { key: 'softbody', scene, camera, get controls() { return controls; }, enter, update, onResize, dispose };
}
