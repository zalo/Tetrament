// Tetrament softbody playground — single-scene WebGPU app with SSGI.
import * as THREE from 'three/webgpu';
import { GUI } from 'lil-gui';
import { pass, mrt, output, normalView, diffuseColor, vec4, add, sample, packNormalToRGB, unpackRGBToNormal } from 'three/tsl';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';

import { createSoftbodyScene } from './scenes/softbody.js';

// ---- DOM refs -------------------------------------------------------------
const viewport = document.getElementById('viewport');
const overlay = document.getElementById('overlay');
const overlayStatus = document.getElementById('overlay-status');
const overlayStatusText = document.getElementById('overlay-status-text');
const overlayError = document.getElementById('overlay-error');
const statsEl = document.getElementById('stats');

const setStatus = (t) => { overlayStatusText.textContent = t; };
const hideOverlay = () => { overlay.classList.add('hidden'); };
const fail = (title, detail) => {
    overlayStatus.classList.add('hidden');
    overlayError.classList.remove('hidden');
    overlayError.innerHTML = `<strong>${title}</strong><br>${detail}`;
    overlay.classList.remove('hidden');
};

// ---- Renderer + SSGI ------------------------------------------------------
let renderer, gui, active = null;
let pipeline = null, ssgiNode = null;
let width = window.innerWidth, height = window.innerHeight;
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

function buildPipeline(scene, camera) {
    disposePipeline();
    const pp = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output: output, diffuseColor: diffuseColor, normal: packNormalToRGB(normalView) }));

    const scenePassColor = scenePass.getTextureNode('output');
    const scenePassDepth = scenePass.getTextureNode('depth');
    const scenePassNormal = scenePass.getTextureNode('normal');
    const scenePassDiffuse = scenePass.getTextureNode('diffuseColor');
    const sceneNormal = sample((uv) => unpackRGBToNormal(scenePassNormal.sample(uv)));

    ssgiNode = ssgi(scenePassColor, scenePassDepth, sceneNormal, camera);
    applySSGIParams();

    const ao = ssgiNode.getAONode();
    const gi = ssgiNode.getGINode();
    const composite = vec4(add(scenePassColor.rgb.mul(ao.r), scenePassDiffuse.rgb.mul(gi.rgb)), scenePassColor.a);
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

    if (active) {
        try {
            active.controls?.update();
            await active.update(dt, now / 1000, fps);
            if (renderCfg.ssgi && pipeline) pipeline.render();
            else renderer.render(active.scene, active.camera);
        } catch (err) {
            console.error('Frame error:', err);
        }
    }
    requestAnimationFrame(frame);
}

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
async function boot() {
    window.addEventListener('resize', onResize);
    await initRenderer();
    frame();

    gui = new GUI({ title: 'Softbody Playground' });
    const scene = createSoftbodyScene();
    await scene.enter(makeCtx());
    scene.camera.aspect = width / height;
    scene.camera.updateProjectionMatrix();
    buildPipeline(scene.scene, scene.camera);
    addRenderingGUI(gui);
    active = scene;
    hideOverlay();
}

boot().catch((err) => {
    console.error(err);
    if (!overlayError.classList.contains('hidden')) return;
    fail('Startup failed', err.message || String(err));
});
