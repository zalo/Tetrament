// Tetrament demo hub — shared WebGPU renderer + scene switcher + SSGI.
import * as THREE from 'three/webgpu';
import { GUI } from 'lil-gui';
import { pass, mrt, output, normalView, diffuseColor, vec4, add, sample, packNormalToRGB, unpackRGBToNormal } from 'three/tsl';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';

import { createSoftbodyScene } from './scenes/softbody.js';
import { createClayScene } from './scenes/clay.js';

// ---- Scene registry -------------------------------------------------------
const SCENES = [
    { key: 'softbody', label: 'Softbody Playground', icon: '🫧',
      sub: 'FEM bodies, colliders & debug',
      desc: 'A GPU-driven FEM sandbox. Spawn tetrahedralized shapes — including arbitrary meshes tetrahedralized on the fly (CDT) — fling them into baked mesh SDF colliders, and peek inside with the tet/strain/collision debug layers.',
      hint: 'Drag <kbd>LMB</kbd> · Orbit <kbd>LMB</kbd> empty space · Zoom <kbd>scroll</kbd> · <kbd>Space</kbd> spawn',
      create: createSoftbodyScene },
    { key: 'clay', label: 'Viscoelastic Clay', icon: '🪱',
      sub: 'Particle clay meets softbodies',
      desc: 'An experimental viscoelastic particle solver (double-density relaxation) sharing the world with tetrahedral softbodies. The clay and the FEM bodies push on each other through the solver’s own spatial grid.',
      hint: 'Drag <kbd>LMB</kbd> softbodies · Orbit empty space · <kbd>Space</kbd> drop clay',
      create: createClayScene },
];

// ---- DOM refs -------------------------------------------------------------
const viewport = document.getElementById('viewport');
const nav = document.getElementById('scene-nav');
const overlay = document.getElementById('overlay');
const overlayStatus = document.getElementById('overlay-status');
const overlayStatusText = document.getElementById('overlay-status-text');
const overlayError = document.getElementById('overlay-error');
const titleEl = document.getElementById('scene-title');
const descEl = document.getElementById('scene-desc');
const hintEl = document.getElementById('scene-hint');
const statsEl = document.getElementById('stats');
const menuToggle = document.getElementById('menu-toggle');
const sidebar = document.getElementById('sidebar');

const setStatus = (t) => { overlayStatusText.textContent = t; };
const showOverlay = () => { overlay.classList.remove('hidden'); overlayStatus.classList.remove('hidden'); };
const hideOverlay = () => { overlay.classList.add('hidden'); };
const fail = (title, detail) => {
    overlayStatus.classList.add('hidden');
    overlayError.classList.remove('hidden');
    overlayError.innerHTML = `<strong>${title}</strong><br>${detail}`;
    overlay.classList.remove('hidden');
};

// ---- Renderer -------------------------------------------------------------
let renderer, gui, active = null, sceneEpoch = 0, switching = false;
let pipeline = null, ssgiNode = null;
let width = window.innerWidth, height = window.innerHeight;

// Global SSGI/rendering settings (persist across scene switches).
const renderCfg = { ssgi: true, giIntensity: 3.0, aoIntensity: 1.0, radius: 7, stepCount: 12, sliceCount: 2 };

async function initRenderer() {
    if (!navigator.gpu) {
        fail('WebGPU not available', 'This demo needs a WebGPU-enabled browser — Chrome/Edge 113+ or Safari 18+. Make sure hardware acceleration is on.');
        throw new Error('WebGPU not supported');
    }

    renderer = new THREE.WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    viewport.appendChild(renderer.domElement);

    setStatus('Initializing WebGPU device…');
    await Promise.race([
        renderer.init(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000)),
    ]);

    if (!renderer.backend.isWebGPUBackend) {
        fail('WebGPU compute unavailable', 'The renderer fell back to WebGL2, which cannot run the compute shaders this demo relies on. Try Chrome/Edge 113+.');
        throw new Error('not webgpu backend');
    }
}

// ---- SSGI post-processing -------------------------------------------------
function buildPipeline(scene, camera) {
    disposePipeline();
    const pp = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    // MRT: beauty, diffuse albedo, and PACKED view normals (packing keeps the
    // normals intact through the render target — storing them raw corrupts SSGI).
    scenePass.setMRT(mrt({
        output: output,
        diffuseColor: diffuseColor,
        normal: packNormalToRGB(normalView),
    }));

    const scenePassColor = scenePass.getTextureNode('output');
    const scenePassDepth = scenePass.getTextureNode('depth');
    const scenePassNormal = scenePass.getTextureNode('normal');
    const scenePassDiffuse = scenePass.getTextureNode('diffuseColor');

    // Unpack normals when sampling (mirrors the three.js SSGI example exactly).
    const sceneNormal = sample((uv) => unpackRGBToNormal(scenePassNormal.sample(uv)));

    ssgiNode = ssgi(scenePassColor, scenePassDepth, sceneNormal, camera);
    applySSGIParams();

    // Composite: beauty attenuated by AO + diffuse albedo lit by indirect GI.
    const ao = ssgiNode.getAONode();
    const gi = ssgiNode.getGINode();
    const composite = vec4(
        add(scenePassColor.rgb.mul(ao.r), scenePassDiffuse.rgb.mul(gi.rgb)),
        scenePassColor.a,
    );
    pp.outputNode = composite;
    pipeline = pp;
}

function applySSGIParams() {
    if (!ssgiNode) return;
    ssgiNode.giIntensity.value = renderCfg.giIntensity;
    ssgiNode.aoIntensity.value = renderCfg.aoIntensity;
    ssgiNode.radius.value = renderCfg.radius;
    ssgiNode.stepCount.value = renderCfg.stepCount;
    ssgiNode.sliceCount.value = renderCfg.sliceCount;
}

function disposePipeline() {
    try { pipeline?.dispose?.(); } catch (e) { /* noop */ }
    pipeline = null;
    ssgiNode = null;
}

function addRenderingGUI(g) {
    const f = g.addFolder('Rendering (SSGI)');
    f.add(renderCfg, 'ssgi').name('Enable SSGI');
    f.add(renderCfg, 'giIntensity', 0, 12, 0.1).name('GI intensity').onChange(applySSGIParams);
    f.add(renderCfg, 'aoIntensity', 0, 2, 0.05).name('AO intensity').onChange(applySSGIParams);
    f.add(renderCfg, 'radius', 2, 16, 0.5).name('Radius').onChange(applySSGIParams);
    f.add(renderCfg, 'stepCount', 4, 24, 1).name('Steps').onChange(applySSGIParams);
    f.add(renderCfg, 'sliceCount', 1, 4, 1).name('Slices').onChange(applySSGIParams);
    f.close();
}

// ---- Scene switching ------------------------------------------------------
function makeCtx() {
    return {
        renderer,
        get width() { return width; },
        get height() { return height; },
        gui,
        setStatus,
        setStats: (html) => { statsEl.innerHTML = html; },
    };
}

async function switchScene(def) {
    if (switching) return;
    switching = true;
    const epoch = ++sceneEpoch;

    showOverlay();
    setStatus(`Loading ${def.label}…`);

    titleEl.textContent = def.label;
    descEl.textContent = def.desc;
    hintEl.innerHTML = def.hint;
    statsEl.innerHTML = '';
    [...nav.children].forEach((b) => b.classList.toggle('active', b.dataset.key === def.key));

    const prev = active;
    active = null;
    disposePipeline();
    if (prev) { try { prev.dispose?.(); } catch (e) { console.warn(e); } }

    if (gui) gui.destroy();
    gui = new GUI({ title: def.label });

    try {
        const scene = def.create();
        await scene.enter(makeCtx());
        if (epoch !== sceneEpoch) { scene.dispose?.(); switching = false; return; }
        scene.camera.aspect = width / height;
        scene.camera.updateProjectionMatrix();
        buildPipeline(scene.scene, scene.camera);
        addRenderingGUI(gui);
        active = scene;
        hideOverlay();
    } catch (err) {
        console.error(err);
        fail(`Could not start “${def.label}”`, err.message || String(err));
    } finally {
        switching = false;
    }
}

// ---- Sidebar nav ----------------------------------------------------------
function buildNav() {
    for (const def of SCENES) {
        const btn = document.createElement('button');
        btn.className = 'scene-btn';
        btn.dataset.key = def.key;
        btn.innerHTML = `<span class="icon">${def.icon}</span>
            <span class="meta"><span>${def.label}</span><small>${def.sub}</small></span>`;
        btn.addEventListener('click', () => {
            location.hash = def.key;
            switchScene(def);
            setMenu(false);
        });
        nav.appendChild(btn);
    }
}

// ---- Render loop ----------------------------------------------------------
let lastTime = performance.now();
let frames = 0, fpsAccum = 0, fps = 0;

async function frame() {
    const now = performance.now();
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    dt = Math.min(dt, 1 / 30);

    frames++; fpsAccum += dt;
    if (fpsAccum >= 0.5) { fps = Math.round(frames / fpsAccum); frames = 0; fpsAccum = 0; }

    if (active && !switching) {
        try {
            active.controls?.update();
            await active.update(dt, now / 1000, fps);
            if (renderCfg.ssgi && pipeline) {
                pipeline.render();
            } else {
                renderer.render(active.scene, active.camera);
            }
        } catch (err) {
            console.error('Frame error:', err);
        }
    }
    requestAnimationFrame(frame);
}

// ---- Resize ---------------------------------------------------------------
function onResize() {
    width = window.innerWidth;
    height = window.innerHeight;
    renderer.setSize(width, height);
    if (active) {
        active.camera.aspect = width / height;
        active.camera.updateProjectionMatrix();
        active.onResize?.(width, height);
    }
}

// ---- Boot -----------------------------------------------------------------
function setMenu(open) {
    sidebar.classList.toggle('open', open);
    // Mirror onto <body> so CSS can hide the (overlapping) GUI while the mobile
    // menu is open — otherwise the fixed GUI panel steals taps over the sidebar.
    document.body.classList.toggle('menu-open', open);
}

async function boot() {
    buildNav();
    menuToggle.addEventListener('click', () => setMenu(!sidebar.classList.contains('open')));
    window.addEventListener('resize', onResize);

    await initRenderer();
    frame();

    const initial = SCENES.find((s) => s.key === location.hash.slice(1)) || SCENES[0];
    await switchScene(initial);

    window.addEventListener('hashchange', () => {
        const def = SCENES.find((s) => s.key === location.hash.slice(1));
        if (def && def.key !== (active && active.key)) switchScene(def);
    });
}

boot().catch((err) => {
    console.error(err);
    if (!overlayError.classList.contains('hidden')) return;
    fail('Startup failed', err.message || String(err));
});
