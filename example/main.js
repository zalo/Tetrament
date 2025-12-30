import * as THREE from '../node_modules/three/build/three.module.js';
import { GUI } from '../node_modules/three/examples/jsm/libs/lil-gui.module.min.js';
import { OBJLoader } from '../node_modules/three/examples/jsm/loaders/OBJLoader.js';
import World from './World.js';
import { mergeVertices } from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

/** The fundamental set up and animation structures for Simulation */
export default class Main {
    constructor() {
        // Intercept Main Window Errors
        window.realConsoleError = console.error;
        window.addEventListener('error', (event) => {
            let path = event.filename.split("/");
            this.display((path[path.length - 1] + ":" + event.lineno + " - " + event.message));
        });
        console.error = this.fakeError.bind(this);
        this.timeMS = 0;
        this.deferredConstructor();
    }

    async deferredConstructor() {
        // Initialize OBJ loader
        this.objLoader = new OBJLoader();

        // Construct the render world
        this.world = new World(this);

        // Configure Settings
        this.simulationParams = {
            addBoundingBox: false,
            verbose: false,
            tetScale: 0.9,
            wireframe: false
        };

        // Initialize with default torus knot geometry
        this.currentGeometry = this.createTorusKnotGeometry();
        this.currentMesh = new THREE.Mesh(
            this.currentGeometry,
            new THREE.MeshStandardMaterial( { color: 0x0077ff, metalness: 0.5, roughness: 0.5 } ));

        this.world.scene.add( this.currentMesh );

        // Setup GUI
        this.setupGUI();
    }

    createTorusKnotGeometry() {
        return new THREE.TorusKnotGeometry( ...Object.values( {
            radius: 0.12,
            tube: 0.04,
            tubularSegments: 30,
            radialSegments: 5,
            p: 2,
            q: 3,
            thickness: 0.1
        } ) );
    }

    setupGUI() {
        this.gui = new GUI();
        
        //// CDT Parameters folder
        //const cdtFolder = this.gui.addFolder('CDT Parameters');
        //cdtFolder.add(this.simulationParams, 'addBoundingBox').name('Add Bounding Box').onChange(() => this.computeAndVisualizeCDT());
        //cdtFolder.add(this.simulationParams, 'verbose').name('Verbose Output').onChange(() => this.computeAndVisualizeCDT());
        //cdtFolder.add(this.simulationParams, 'tetScale', 0.1, 1.0, 0.1).name('Tetrahedra Scale').onChange(() => this.computeAndVisualizeCDT());
        //cdtFolder.add(this.simulationParams, 'wireframe').name('Wireframe Mode').onChange(() => this.computeAndVisualizeCDT());
        //cdtFolder.open();

        //// Mesh Controls folder
        //const meshFolder = this.gui.addFolder('Mesh Controls');
        //
        //// Add file upload button
        //const uploadButton = { uploadMesh: () => this.uploadMeshFile() };
        //meshFolder.add(uploadButton, 'uploadMesh').name('Upload Mesh File');
        //
        //// Add reset to default button
        //const resetButton = { resetToDefault: () => this.resetToDefaultGeometry() };
        //meshFolder.add(resetButton, 'resetToDefault').name('Reset to Torus Knot');
        //meshFolder.open();
    }


    /** Update the simulation */
    update(timeMS) {
        this.deltaTime = timeMS - this.timeMS;
        this.timeMS = timeMS;
        this.world.controls.update();
        this.world.renderer.render(this.world.scene, this.world.camera);
        this.world.stats.update();
    }

    // Log Errors as <div>s over the main viewport
    fakeError(...args) {
        if (args.length > 0 && args[0]) { this.display(JSON.stringify(args[0])); }
        window.realConsoleError.apply(console, arguments);
    }

    display(text) {
        let errorNode = window.document.createElement("div");
        errorNode.innerHTML = text.fontcolor("red");
        window.document.getElementById("info").appendChild(errorNode);
    }
}

var main = new Main();
window.main = main;
