/**
 * Mouse drag control for softbody interaction
 * Drags a single vertex toward the cursor position
 * @module tetrament/controls/DragControl
 */

import * as THREE from 'three';

/**
 * Enables mouse dragging of softbodies
 */
export class DragControl {
    /**
     * @param {SoftbodySimulation} simulation - Physics simulation
     * @param {THREE.Camera} camera - Camera for raycasting
     * @param {HTMLElement} domElement - DOM element for events
     * @param {Object} [options] - Configuration options
     * @param {number} [options.strength=0.5] - Drag strength (0-1)
     * @param {number} [options.maxDistance=0.15] - Max raycast distance to find vertex
     * @param {string} [options.button='left'] - Mouse button ('left', 'right', 'middle')
     * @param {THREE.Scene} [options.scene] - Scene to add visual helpers to
     * @param {Object} [options.orbitControls] - OrbitControls to disable during drag
     */
    constructor(simulation, camera, domElement, options = {}) {
        this.simulation = simulation;
        this.camera = camera;
        this.domElement = domElement;

        this.strength = options.strength ?? 0.5;
        this.maxDistance = options.maxDistance ?? 0.15;
        this.button = options.button ?? 'left';
        this.scene = options.scene ?? null;
        this.orbitControls = options.orbitControls ?? null;

        this.enabled = true;
        this.isDragging = false;
        this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1));
        this.targetPosition = new THREE.Vector3();
        this.vertexPosition = new THREE.Vector3();

        // Dragged vertex info
        this.draggedVertexId = -1;
        this.dragDistance = 0;

        this._raycaster = new THREE.Raycaster();
        this._mouse = new THREE.Vector2();

        // Visual helpers
        this._vertexSphere = null;
        this._targetSphere = null;
        this._dragLine = null;
        this._createVisualHelpers();

        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);

        this._addEventListeners();
    }

    /**
     * Creates visual helper objects (spheres and line)
     */
    _createVisualHelpers() {
        // Sphere at dragged vertex
        const vertexGeom = new THREE.SphereGeometry(0.05, 16, 16);
        const vertexMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8 });
        this._vertexSphere = new THREE.Mesh(vertexGeom, vertexMat);
        this._vertexSphere.visible = false;

        // Sphere at target position
        const targetGeom = new THREE.SphereGeometry(0.05, 16, 16);
        const targetMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.8 });
        this._targetSphere = new THREE.Mesh(targetGeom, targetMat);
        this._targetSphere.visible = false;

        // Line connecting them
        const lineGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const lineMat = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2 });
        this._dragLine = new THREE.Line(lineGeom, lineMat);
        this._dragLine.visible = false;

        if (this.scene) {
            this.scene.add(this._vertexSphere);
            this.scene.add(this._targetSphere);
            this.scene.add(this._dragLine);
        }
    }

    /**
     * Updates visual helper positions
     */
    _updateVisualHelpers() {
        if (!this.isDragging) {
            this._vertexSphere.visible = false;
            this._targetSphere.visible = false;
            this._dragLine.visible = false;
            return;
        }

        this._vertexSphere.position.copy(this.vertexPosition);
        this._vertexSphere.visible = true;

        this._targetSphere.position.copy(this.targetPosition);
        this._targetSphere.visible = true;

        // Update line
        const positions = this._dragLine.geometry.attributes.position.array;
        positions[0] = this.vertexPosition.x;
        positions[1] = this.vertexPosition.y;
        positions[2] = this.vertexPosition.z;
        positions[3] = this.targetPosition.x;
        positions[4] = this.targetPosition.y;
        positions[5] = this.targetPosition.z;
        this._dragLine.geometry.attributes.position.needsUpdate = true;
        this._dragLine.visible = true;
    }

    /**
     * Adds event listeners
     */
    _addEventListeners() {
        this.domElement.addEventListener('pointerdown', this._onPointerDown);
        this.domElement.addEventListener('pointermove', this._onPointerMove);
        this.domElement.addEventListener('pointerup', this._onPointerUp);
        this.domElement.addEventListener('pointerleave', this._onPointerUp);
    }

    /**
     * Removes event listeners
     */
    _removeEventListeners() {
        this.domElement.removeEventListener('pointerdown', this._onPointerDown);
        this.domElement.removeEventListener('pointermove', this._onPointerMove);
        this.domElement.removeEventListener('pointerup', this._onPointerUp);
        this.domElement.removeEventListener('pointerleave', this._onPointerUp);
    }

    /**
     * Updates mouse coordinates
     * @param {PointerEvent} event
     */
    _updateMouse(event) {
        const rect = this.domElement.getBoundingClientRect();
        this._mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this._mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    /**
     * Gets the correct button index
     * @returns {number}
     */
    _getButtonIndex() {
        switch (this.button) {
            case 'left': return 0;
            case 'middle': return 1;
            case 'right': return 2;
            default: return 0;
        }
    }

    /**
     * Handles pointer down event
     * @param {PointerEvent} event
     */
    async _onPointerDown(event) {
        if (!this.enabled) return;
        //if (event.button !== this._getButtonIndex()) return;

        this._updateMouse(event);
        this._raycaster.setFromCamera(this._mouse, this.camera);

        // Find closest vertex to ray
        const closest = await this.simulation.findNearestVertex(
            this._raycaster.ray.origin,
            this._raycaster.ray.direction,
            this.maxDistance
        );
        if (!closest) return;

        this.isDragging = true;
        this.draggedVertexId = closest.vertexId;
        this.dragDistance = closest.distance;
        this.vertexPosition.copy(closest.position);

        // Disable orbit controls during drag
        if (this.orbitControls) {
            this.orbitControls.enabled = false;
        }

        // Set drag plane perpendicular to camera at the vertex depth
        const cameraDir = this.camera.getWorldDirection(new THREE.Vector3());
        this.dragPlane.setFromNormalAndCoplanarPoint(cameraDir.negate(), this.vertexPosition);

        // Initial target is the vertex position
        this.targetPosition.copy(this.vertexPosition);

        // Start drag constraint in simulation
        this.simulation.startDrag(this.draggedVertexId, this.targetPosition, this.strength);

        this._updateVisualHelpers();
    }

    /**
     * Handles pointer move event
     * @param {PointerEvent} event
     */
    async _onPointerMove(event) {
        if (!this.enabled || !this.isDragging) return;

        this._updateMouse(event);
        this._raycaster.setFromCamera(this._mouse, this.camera);

        // Get new target point on drag plane
        const newTarget = new THREE.Vector3();
        if (this._raycaster.ray.intersectPlane(this.dragPlane, newTarget)) {
            this.targetPosition.copy(newTarget);

            // Update drag target in simulation
            this.simulation.updateDrag(this.targetPosition);
        }

        // Read current vertex position for visual feedback
        const vertexPos = await this.simulation.getVertexPosition(this.draggedVertexId);
        this.vertexPosition.copy(vertexPos);

        this._updateVisualHelpers();
    }

    /**
     * Handles pointer up event
     * @param {PointerEvent} event
     */
    _onPointerUp(event) {
        // For pointerleave, always end drag if active
        // For pointerup, check if it's the correct button
        //if (event.type === 'pointerup' && event.button !== this._getButtonIndex()) return;

        if (this.isDragging) {
            this.simulation.endDrag();

            // Re-enable orbit controls after drag
            if (this.orbitControls) {
                this.orbitControls.enabled = true;
            }
        }

        this.isDragging = false;
        this.draggedVertexId = -1;
        this._updateVisualHelpers();
    }

    /**
     * Sets the drag strength
     * @param {number} strength - Strength value (0-1)
     */
    setStrength(strength) {
        this.strength = strength;
    }

    /**
     * Adds visual helpers to a scene
     * @param {THREE.Scene} scene
     */
    addToScene(scene) {
        this.scene = scene;
        scene.add(this._vertexSphere);
        scene.add(this._targetSphere);
        scene.add(this._dragLine);
    }

    /**
     * Enables the control
     */
    enable() {
        this.enabled = true;
    }

    /**
     * Disables the control
     */
    disable() {
        this.enabled = false;
        if (this.isDragging) {
            this.simulation.endDrag();

            // Re-enable orbit controls
            if (this.orbitControls) {
                this.orbitControls.enabled = true;
            }
        }
        this.isDragging = false;
        this._updateVisualHelpers();
    }

    /**
     * Disposes resources
     */
    dispose() {
        this._removeEventListeners();
        if (this._vertexSphere) {
            this._vertexSphere.geometry.dispose();
            this._vertexSphere.material.dispose();
            if (this.scene) this.scene.remove(this._vertexSphere);
        }
        if (this._targetSphere) {
            this._targetSphere.geometry.dispose();
            this._targetSphere.material.dispose();
            if (this.scene) this.scene.remove(this._targetSphere);
        }
        if (this._dragLine) {
            this._dragLine.geometry.dispose();
            this._dragLine.material.dispose();
            if (this.scene) this.scene.remove(this._dragLine);
        }
    }
}
