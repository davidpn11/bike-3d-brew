import * as THREE from 'three';
import { type Box, moveFace } from '../scene/crop';

/** What the crop editor needs from the viewer (kept narrow so the two stay decoupled). */
export interface CropHost {
  readonly camera: THREE.PerspectiveCamera;
  readonly modelRoot: THREE.Object3D;
  readonly scene: THREE.Scene;
  /** Element receiving pointer events (the viewer container). */
  readonly eventTarget: HTMLElement;
  /** Live clipping while dragging, without touching the store. */
  previewCrop(box: Box): void;
  onFrame(fn: () => void): () => void;
}

const AXES = [0, 1, 2] as const;
const SIDES = ['min', 'max'] as const;
const HANDLE_PX = 11; // visible radius; touch gets a larger hit radius
const HIT_PX = 22;

/**
 * Edit-mode crop box: a wireframe plus one handle per face, in model-root space (the group
 * copies the model root's matrix). Dragging a handle moves that face along its axis with mouse
 * or touch; the box is committed once, on release. Per-frame work only rescales the handles to
 * a constant screen size, using preallocated scratch objects.
 */
export class CropBoxEditor {
  readonly group = new THREE.Group();
  onCommit: (box: Box) => void = () => {};

  private box: Box | null = null;
  private visible = false;
  private lines: THREE.LineSegments;
  private handles: THREE.Mesh[] = [];
  private handleMat: THREE.MeshBasicMaterial;
  private activeMat: THREE.MeshBasicMaterial;
  private drag: { handle: THREE.Mesh; axis: 0 | 1 | 2; side: 'min' | 'max'; origin: THREE.Vector3; dir: THREE.Vector3; pointerId: number } | null = null;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private inv = new THREE.Matrix4();

  constructor(private host: CropHost) {
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;
    const overlay = { depthTest: false, depthWrite: false, transparent: true };
    this.lines = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xff5a1f, opacity: 0.9, ...overlay }));
    this.lines.renderOrder = 10;
    this.handleMat = new THREE.MeshBasicMaterial({ color: 0xff5a1f, ...overlay });
    this.activeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, ...overlay });
    const sphere = new THREE.SphereGeometry(1, 16, 12);
    for (const axis of AXES) {
      for (const side of SIDES) {
        const handle = new THREE.Mesh(sphere, this.handleMat);
        handle.renderOrder = 11;
        handle.userData = { axis, side };
        this.handles.push(handle);
      }
    }
    this.group.add(this.lines, ...this.handles);
    host.scene.add(this.group);

    // Capture phase on the container runs before OrbitControls / tap-to-pin on the canvas,
    // so grabbing a handle never also orbits the camera or drops a comment.
    const el = host.eventTarget;
    el.addEventListener('pointerdown', (e) => this.onDown(e), { capture: true });
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    host.onFrame(() => this.update());
  }

  /** Follows the model root (call whenever its transform changes). */
  syncTransform(): void {
    this.group.matrix.copy(this.host.modelRoot.matrixWorld);
    this.group.matrixWorldNeedsUpdate = true;
  }

  setBox(box: Box | null): void {
    if (this.drag) return; // the store echo of our own preview must not fight the drag
    this.box = box;
    this.layout();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.group.visible = visible && !!this.box;
  }

  get dragging(): boolean {
    return !!this.drag;
  }

  private layout(): void {
    const box = this.box;
    this.group.visible = this.visible && !!box;
    if (!box) return;
    const [x0, y0, z0] = box.min;
    const [x1, y1, z1] = box.max;
    this.lines.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.lines.scale.set(x1 - x0, y1 - y0, z1 - z0);
    for (const handle of this.handles) {
      const { axis, side } = handle.userData as { axis: 0 | 1 | 2; side: 'min' | 'max' };
      handle.position.copy(this.lines.position);
      handle.position.setComponent(axis, box[side][axis]);
    }
  }

  private update(): void {
    if (!this.group.visible) return;
    const cam = this.host.camera;
    const viewportPx = this.host.eventTarget.clientHeight || 1;
    const perPx = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / viewportPx;
    const scale = this.host.modelRoot.scale.x || 1;
    for (const handle of this.handles) {
      handle.getWorldPosition(this.tmp);
      const r = this.tmp.distanceTo(cam.position) * perPx * HANDLE_PX;
      handle.scale.setScalar(r / scale);
    }
  }

  private hitHandle(e: PointerEvent): THREE.Mesh | null {
    const rect = this.host.eventTarget.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.host.camera);
    // Screen-space test with a generous radius: spheres are tiny targets for a finger.
    let best: THREE.Mesh | null = null;
    let bestD = Infinity;
    for (const handle of this.handles) {
      handle.getWorldPosition(this.tmp).project(this.host.camera);
      if (this.tmp.z > 1) continue;
      const dx = ((this.tmp.x - this.ndc.x) / 2) * rect.width;
      const dy = ((this.tmp.y - this.ndc.y) / 2) * rect.height;
      const d = Math.hypot(dx, dy);
      const radius = e.pointerType === 'touch' ? HIT_PX * 1.5 : HIT_PX;
      if (d < radius && d < bestD) {
        bestD = d;
        best = handle;
      }
    }
    return best;
  }

  private onDown(e: PointerEvent): void {
    if (!this.group.visible || !this.box || this.drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const handle = this.hitHandle(e);
    if (!handle) return;
    e.stopPropagation();
    e.preventDefault();
    const { axis, side } = handle.userData as { axis: 0 | 1 | 2; side: 'min' | 'max' };
    const origin = handle.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3().setComponent(axis, 1).transformDirection(this.host.modelRoot.matrixWorld);
    this.drag = { handle, axis, side, origin, dir, pointerId: e.pointerId };
    handle.material = this.activeMat;
    this.host.eventTarget.setPointerCapture?.(e.pointerId);
  }

  private onMove(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId || !this.box) return;
    e.stopPropagation();
    const rect = this.host.eventTarget.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.host.camera);
    // Closest point on the handle's axis line to the pointer ray.
    const { origin: o, dir: d } = drag;
    const r = this.raycaster.ray;
    const w0 = this.tmp.copy(o).sub(r.origin);
    const b = d.dot(r.direction);
    const denom = 1 - b * b;
    if (denom < 1e-4) return; // looking straight down the axis: no stable drag direction
    const s = (b * r.direction.dot(w0) - d.dot(w0)) / denom;
    const onLine = this.tmp2.copy(o).addScaledVector(d, s);
    this.inv.copy(this.host.modelRoot.matrixWorld).invert();
    onLine.applyMatrix4(this.inv);
    this.box = moveFace(this.box, drag.axis, drag.side, onLine.getComponent(drag.axis));
    this.layout();
    this.host.previewCrop(this.box);
  }

  private onUp(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.stopPropagation();
    drag.handle.material = this.handleMat;
    this.drag = null;
    this.host.eventTarget.releasePointerCapture?.(e.pointerId);
    if (this.box) this.onCommit(this.box);
  }
}
