/**
 * Mouse drag control for softbody interaction
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
     * @param {number} [options.force=0.25] - Force magnitude
     * @param {number} [options.radius=0.3] - Influence radius
     * @param {string} [options.button='left'] - Mouse button ('left', 'right', 'middle')
     */
    constructor(simulation, camera, domElement, options = {}) {
        this.simulation = simulation;
        this.camera = camera;
        this.domElement = domElement;

        this.force = options.force ?? 0.25;
        this.radius = options.radius ?? 0.3;
        this.button = options.button ?? 'left';

        this.enabled = true;
        this.isDragging = false;
        this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1));
        this.dragPoint = new THREE.Vector3();
        this.previousPoint = new THREE.Vector3();

        this._raycaster = new THREE.Raycaster();
        this._mouse = new THREE.Vector2();

        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);

        this._addEventListeners();
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
    _onPointerDown(event) {
        if (!this.enabled) return;
        if (event.button !== this._getButtonIndex()) return;

        this._updateMouse(event);
        this._raycaster.setFromCamera(this._mouse, this.camera);

        this.isDragging = true;
        this.dragPoint.copy(this._raycaster.ray.origin);
        this.previousPoint.copy(this.dragPoint);

        // Set drag plane perpendicular to camera
        this.dragPlane.normal.copy(this.camera.getWorldDirection(new THREE.Vector3()).negate());
        this.dragPlane.setFromNormalAndCoplanarPoint(this.dragPlane.normal, this.dragPoint);

        // Apply initial force
        this._applyForce(new THREE.Vector3(0, -this.force, 0));
    }

    /**
     * Handles pointer move event
     * @param {PointerEvent} event
     */
    _onPointerMove(event) {
        if (!this.enabled || !this.isDragging) return;

        this._updateMouse(event);
        this._raycaster.setFromCamera(this._mouse, this.camera);

        // Get new point on drag plane
        const newPoint = new THREE.Vector3();
        this._raycaster.ray.intersectPlane(this.dragPlane, newPoint);

        if (newPoint) {
            // Calculate drag force from movement
            const delta = new THREE.Vector3().subVectors(newPoint, this.previousPoint);
            const force = delta.multiplyScalar(this.force * 10);

            this._applyForce(force);
            this.previousPoint.copy(newPoint);
            this.dragPoint.copy(newPoint);
        }
    }

    /**
     * Handles pointer up event
     * @param {PointerEvent} event
     */
    _onPointerUp(event) {
        if (event.button !== this._getButtonIndex()) return;
        this.isDragging = false;
    }

    /**
     * Applies force to softbodies
     * @param {THREE.Vector3} force - Force to apply
     */
    async _applyForce(force) {
        this._raycaster.setFromCamera(this._mouse, this.camera);
        await this.simulation.onPointerDown(
            this._raycaster.ray.origin,
            this._raycaster.ray.direction,
            force
        );
    }

    /**
     * Sets the drag force
     * @param {number} force
     */
    setForce(force) {
        this.force = force;
    }

    /**
     * Sets the influence radius
     * @param {number} radius
     */
    setRadius(radius) {
        this.radius = radius;
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
        this.isDragging = false;
    }

    /**
     * Disposes resources
     */
    dispose() {
        this._removeEventListeners();
    }
}
