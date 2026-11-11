import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { easeInOutCubic, lerpView, viewForBox } from '../scene/camera';
import { type Box, insideBox } from '../scene/crop';
import type { BackgroundMode, CameraView, CropBox, ModelRef, Vec3 } from '../scene/schema';
import { CropBoxEditor } from './cropBox';

export const CHROMA_GREEN = 0x00b140;

export interface PickResult {
  /** Surface point and normal in model-root space (what annotations store). */
  position: Vec3;
  normal?: Vec3;
}

type FrameListener = () => void;

const toVec3 = (v: THREE.Vector3): Vec3 => [round(v.x), round(v.y), round(v.z)];
const round = (n: number) => Math.round(n * 1e5) / 1e5;

/**
 * Owns the renderer, camera, controls and the model root. All positions crossing this
 * boundary (hotspot views, annotation points) are in model-root space, so re-orienting
 * a capture via ModelRef.rotation/scale keeps every comment glued to the bike.
 */
export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly modelRoot = new THREE.Group();

  private ground: THREE.Mesh;
  private flight: { from: CameraView; to: CameraView; start: number; duration: number; resolve: () => void } | null = null;
  private frameListeners = new Set<FrameListener>();
  private raycaster = new THREE.Raycaster();
  private resizeObserver: ResizeObserver;
  private background: BackgroundMode = 'transparent';
  private ref: ModelRef = { url: '', format: 'demo' };
  /** Active crop in model-root space (null = no clipping) and its six world-space clip planes. */
  private crop: Box | null = null;
  private readonly clipPlanes = Array.from({ length: 6 }, () => new THREE.Plane());
  private clippedMaterials = false;
  private readonly scratch = new THREE.Vector3();
  private readonly rootInverse = new THREE.Matrix4();
  readonly cropEditor: CropBoxEditor;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    this.camera.position.set(1.6, 0.9, 2.2);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.12;
    this.controls.maxDistance = 10;
    this.controls.target.set(0, 0.5, 0);
    // Any user input cancels an in-progress fly-to instead of fighting it.
    this.controls.addEventListener('start', () => this.cancelFlight());

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 4, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -1.5;
    sun.shadow.camera.right = sun.shadow.camera.top = 1.5;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x444444, 0.6));

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.22 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground, this.modelRoot);
    this.cropEditor = new CropBoxEditor({
      camera: this.camera,
      modelRoot: this.modelRoot,
      scene: this.scene,
      eventTarget: container,
      previewCrop: (box) => this.applyCrop(box),
      onFrame: (fn) => this.onFrame(fn),
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop((t) => this.tick(t));
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }

  onFrame(fn: FrameListener): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  setBackground(mode: BackgroundMode): void {
    this.background = mode;
    this.container.dataset.background = mode;
    if (mode === 'green') this.renderer.setClearColor(CHROMA_GREEN, 1);
    else this.renderer.setClearColor(0x000000, 0);
    // A soft contact shadow looks great on studio backdrops but ruins a chroma key.
    this.ground.visible = mode !== 'green';
  }

  getBackground(): BackgroundMode {
    return this.background;
  }

  /** True while a fly-to animation is running (E2E tests wait on it instead of sleeping). */
  get flying(): boolean {
    return this.flight !== null;
  }

  /** Replaces the displayed model; `object` should already be centered (see centerOnGround). */
  setModel(object: THREE.Object3D, ref: ModelRef): void {
    for (const child of [...this.modelRoot.children]) {
      this.modelRoot.remove(child);
      disposeObject(child);
    }
    object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.modelRoot.add(object);
    this.clippedMaterials = !this.crop; // force (re)assigning clip planes to the new materials
    this.applyTransform(ref);
    this.applyCrop(this.crop);
  }

  applyTransform(ref: ModelRef): void {
    this.modelRoot.scale.setScalar(ref.scale ?? 1);
    this.modelRoot.rotation.set(...(ref.rotation ?? [0, 0, 0]));
    this.modelRoot.position.set(...(ref.offset ?? [0, 0, 0]));
    this.modelRoot.updateMatrixWorld(true);
    this.ref = ref;
    this.rootInverse.copy(this.modelRoot.matrixWorld).invert();
    this.updateClipPlanes();
    this.cropEditor.syncTransform();
  }

  /** Shows or hides the scene's crop box (clipping + pick filtering). Cheap when nothing changed. */
  setCrop(crop: CropBox | undefined): void {
    const box = crop?.enabled ? crop : null;
    this.cropEditor.setBox(box);
    this.applyCrop(box);
  }

  getCrop(): Box | null {
    return this.crop;
  }

  /** True unless the active crop box clips this model-root point away (used to hide pins). */
  inCrop(position: Vec3): boolean {
    return !this.crop || insideBox(this.crop, position[0], position[1], position[2]);
  }

  private applyCrop(box: Box | null): void {
    this.crop = box ? { min: [...box.min], max: [...box.max] } : null;
    this.updateClipPlanes();
    const enabled = !!box;
    if (enabled === this.clippedMaterials) return;
    this.clippedMaterials = enabled;
    // Local clipping on the model's own materials only: the ground shadow and overlays stay whole.
    this.modelRoot.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
        m.clippingPlanes = enabled ? this.clipPlanes : null;
        m.clipShadows = enabled;
        m.needsUpdate = true;
      }
    });
  }

  /** Model-root box → six world planes (normals pointing inside). No allocations: runs on every transform change. */
  private updateClipPlanes(): void {
    const box = this.crop;
    if (!box) return;
    for (let axis = 0; axis < 3; axis++) {
      const lo = this.clipPlanes[axis * 2];
      const hi = this.clipPlanes[axis * 2 + 1];
      lo.normal.set(0, 0, 0).setComponent(axis, 1);
      lo.constant = -box.min[axis];
      hi.normal.set(0, 0, 0).setComponent(axis, -1);
      hi.constant = box.max[axis];
      lo.applyMatrix4(this.modelRoot.matrixWorld);
      hi.applyMatrix4(this.modelRoot.matrixWorld);
    }
  }

  /** False for a world point the crop box clips away. */
  private visibleAt(world: THREE.Vector3): boolean {
    if (!this.crop) return true;
    const p = this.scratch.copy(world).applyMatrix4(this.rootInverse);
    return insideBox(this.crop, p.x, p.y, p.z);
  }

  /** Bounding box of a named sub-object (or the whole model) in model-root space. */
  boundsOf(name?: string): THREE.Box3 | null {
    const target = name ? this.modelRoot.getObjectByName(name) : this.modelRoot;
    if (!target) return null;
    this.modelRoot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return null;
    return box.applyMatrix4(this.modelRoot.matrixWorld.clone().invert());
  }

  /** A pleasant three-quarter view of a box (model-root space) for the current viewport. */
  viewOfBounds(box: THREE.Box3, direction: Vec3 = [1, 0.35, 1.4], padding = 1.15): CameraView {
    return viewForBox(toVec3(box.min), toVec3(box.max), direction, this.camera.fov, this.camera.aspect, padding);
  }

  overviewView(): CameraView {
    // Framed in world space (camera up is world +Y), then stored in model-root space like every view,
    // so a re-oriented capture is still seen from above and from its drive side.
    // Exact (vertex) bounds of what is visible: the cheap box of rotated boxes is far too loose for a
    // tilted capture, and a cropped area scan should frame the bike, not the room.
    const box = this.boundsWith(this.ref).translate(new THREE.Vector3(...(this.ref.offset ?? [0, 0, 0])));
    if (box.isEmpty()) return { position: [1.6, 0.9, 2.2], target: [0, 0.5, 0] };
    const world = viewForBox(toVec3(box.min), toVec3(box.max), [1, 0.35, 1.4], this.camera.fov, this.camera.aspect, 1.15);
    return { position: this.toModel(new THREE.Vector3(...world.position)), target: this.toModel(new THREE.Vector3(...world.target)) };
  }

  /**
   * Up to `max` vertex positions of the loaded model in model-root space (before ModelRef's
   * rotation/scale/offset), strided across all meshes and point clouds: input for auto-orient.
   */
  samplePositions(max = 200_000, opts: { ignoreCrop?: boolean } = {}): Float32Array {
    const crop = opts.ignoreCrop ? null : this.crop;
    this.modelRoot.updateMatrixWorld(true);
    const rootInv = this.modelRoot.matrixWorld.clone().invert();
    const sources: { attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute; matrix: THREE.Matrix4 }[] = [];
    let total = 0;
    this.modelRoot.traverse((o) => {
      const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      const attr = geo?.getAttribute?.('position');
      if (!attr || !((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints)) return;
      sources.push({ attr, matrix: rootInv.clone().multiply(o.matrixWorld) });
      total += attr.count;
    });
    const stride = Math.max(1, Math.ceil(total / max));
    const out = new Float32Array(Math.ceil(total / stride) * 3 + sources.length * 3);
    const v = new THREE.Vector3();
    let k = 0;
    let carry = 0;
    for (const { attr, matrix } of sources) {
      for (let i = carry; i < attr.count; i += stride) {
        v.fromBufferAttribute(attr, i).applyMatrix4(matrix);
        if (crop && !insideBox(crop, v.x, v.y, v.z)) continue;
        out[k++] = v.x;
        out[k++] = v.y;
        out[k++] = v.z;
      }
      carry = (carry + stride - (attr.count % stride)) % stride;
    }
    return out.subarray(0, k);
  }

  /**
   * Points on the model's surface in model-root space, ignoring the crop: vertices plus points
   * along every triangle edge at most `diag / 150` apart. Low-poly meshes (long thin triangles,
   * like a tube with vertices only at its ends) would otherwise look like disconnected blobs to
   * the crop suggestion's cluster search. Triangles are strided to stay near `max` points.
   */
  sampleSurface(max = 150_000): Float32Array {
    this.modelRoot.updateMatrixWorld(true);
    const bounds = this.boundsOf();
    if (!bounds) return new Float32Array(0);
    const spacing = bounds.getSize(new THREE.Vector3()).length() / 150;
    const rootInv = this.modelRoot.matrixWorld.clone().invert();
    const meshes: { geo: THREE.BufferGeometry; matrix: THREE.Matrix4; tris: number }[] = [];
    let totalTris = 0;
    this.modelRoot.traverse((o) => {
      const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      const pos = geo?.getAttribute?.('position');
      if (!geo || !pos || !(o as THREE.Mesh).isMesh) return;
      const tris = Math.floor((geo.index ? geo.index.count : pos.count) / 3);
      meshes.push({ geo, matrix: rootInv.clone().multiply(o.matrixWorld), tris });
      totalTris += tris;
    });
    if (!totalTris) return this.samplePositions(max, { ignoreCrop: true });
    const stride = Math.max(1, Math.ceil(totalTris / (max / 4)));
    const out: number[] = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const corners = [a, b, c];
    for (const { geo, matrix, tris } of meshes) {
      const pos = geo.getAttribute('position');
      const index = geo.index;
      for (let t = 0; t < tris && out.length < max * 3; t += stride) {
        for (let k = 0; k < 3; k++) corners[k].fromBufferAttribute(pos, index ? index.getX(t * 3 + k) : t * 3 + k).applyMatrix4(matrix);
        for (let k = 0; k < 3; k++) {
          const p = corners[k];
          const q = corners[(k + 1) % 3];
          const steps = Math.min(64, Math.ceil(p.distanceTo(q) / spacing));
          for (let i = 0; i < steps; i++) {
            const f = i / steps;
            out.push(p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f, p.z + (q.z - p.z) * f);
          }
        }
      }
    }
    return new Float32Array(out);
  }

  /**
   * World-space bounds the model would have with `ref`'s rotation and scale and no offset
   * (exact, vertex by vertex, only what the crop box keeps). Used to drop a re-oriented model
   * onto the ground, to measure it and to frame the overview.
   */
  boundsWith(ref: Pick<ModelRef, 'rotation' | 'scale'>): THREE.Box3 {
    this.modelRoot.updateMatrixWorld(true);
    const rootInv = this.modelRoot.matrixWorld.clone().invert();
    const place = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...(ref.rotation ?? [0, 0, 0]), 'XYZ')).scale(new THREE.Vector3().setScalar(ref.scale ?? 1));
    const box = new THREE.Box3();
    const local = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const crop = this.crop;
    this.modelRoot.traverse((o) => {
      const attr = ((o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined)?.getAttribute?.('position');
      if (!attr || !((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints)) return;
      local.multiplyMatrices(rootInv, o.matrixWorld);
      for (let i = 0; i < attr.count; i++) {
        v.fromBufferAttribute(attr, i).applyMatrix4(local);
        if (crop && !insideBox(crop, v.x, v.y, v.z)) continue;
        box.expandByPoint(v.applyMatrix4(place));
      }
    });
    return box;
  }

  /** The offset that centers the model on X/Z and stands it on y = 0 for a rotation/scale. */
  groundedOffset(ref: Pick<ModelRef, 'rotation' | 'scale'>): Vec3 {
    const box = this.boundsWith(ref);
    if (box.isEmpty()) return [0, 0, 0];
    const c = box.getCenter(new THREE.Vector3());
    return [round(-c.x), round(-box.min.y), round(-c.z)];
  }

  /** Current camera as a model-root-space view (for "save this view as an area"). */
  getView(): CameraView {
    return { position: this.toModel(this.camera.position), target: this.toModel(this.controls.target) };
  }

  setView(view: CameraView): void {
    this.cancelFlight();
    this.camera.position.copy(this.toWorld(view.position));
    this.controls.target.copy(this.toWorld(view.target));
    this.controls.update();
    // pick() and project() read the camera matrices, which otherwise only refresh on the next
    // rendered frame: a tap right after an instant (reduced-motion) fly-to would miss the model.
    this.camera.updateMatrixWorld();
  }

  flyTo(view: CameraView, duration = 900): Promise<void> {
    this.cancelFlight();
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.setView(view);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.flight = { from: this.getView(), to: view, start: performance.now(), duration, resolve };
    });
  }

  /** Raycasts the model under a client-space point. */
  pick(clientX: number, clientY: number): PickResult | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.params.Points.threshold = 0.01;
    // Cropped-away geometry is invisible, so it must not take comments either.
    const hit = this.raycaster.intersectObject(this.modelRoot, true).find((h) => this.visibleAt(h.point));
    if (!hit) return null;
    const result: PickResult = { position: this.toModel(hit.point) };
    if (hit.face) {
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      // Back into model-root space without scale.
      const inv = new THREE.Quaternion().setFromRotationMatrix(this.modelRoot.matrixWorld).invert();
      result.normal = toVec3(normal.applyQuaternion(inv).normalize());
    }
    return result;
  }

  /**
   * First surface point of a named part seen from `direction` (model-root space), used to
   * place default comments on real geometry rather than at a bounding-box center in mid-air.
   */
  surfacePoint(name: string, direction: Vec3): PickResult | null {
    const part = this.modelRoot.getObjectByName(name);
    const box = this.boundsOf(name);
    if (!part || !box) return null;
    const center = this.toWorld(toVec3(box.getCenter(new THREE.Vector3())));
    const dir = new THREE.Vector3(...direction).normalize();
    const origin = center.clone().addScaledVector(dir, 5);
    this.raycaster.set(origin, dir.clone().negate());
    const hit = this.raycaster.intersectObject(part, true)[0];
    if (!hit) return { position: this.toModel(center) };
    const normal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld);
    return { position: this.toModel(hit.point), normal: normal ? toVec3(normal) : undefined };
  }

  /** True when something on the model sits between the camera and this model-space point. */
  isOccluded(position: Vec3): boolean {
    const world = this.toWorld(position);
    const dir = world.clone().sub(this.camera.position);
    const dist = dir.length();
    this.raycaster.set(this.camera.position, dir.normalize());
    this.raycaster.far = dist;
    const hit = this.raycaster.intersectObject(this.modelRoot, true).find((h) => this.visibleAt(h.point));
    this.raycaster.far = Infinity;
    return !!hit && hit.distance < dist - Math.max(0.01, dist * 0.01);
  }

  /** Projects a model-space point to container pixels; null when behind the camera. */
  project(position: Vec3): { x: number; y: number } | null {
    const v = this.toWorld(position).project(this.camera);
    if (v.z > 1) return null;
    const { clientWidth: w, clientHeight: h } = this.container;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  toWorld(v: Vec3): THREE.Vector3 {
    return new THREE.Vector3(...v).applyMatrix4(this.modelRoot.matrixWorld);
  }

  toModel(v: THREE.Vector3): Vec3 {
    return toVec3(v.clone().applyMatrix4(this.modelRoot.matrixWorld.clone().invert()));
  }

  private cancelFlight(): void {
    if (!this.flight) return;
    const { resolve } = this.flight;
    this.flight = null;
    resolve();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private tick(now: number): void {
    if (this.flight) {
      const { from, to, start, duration, resolve } = this.flight;
      const t = Math.min(1, (now - start) / duration);
      const v = lerpView(from, to, easeInOutCubic(t));
      this.camera.position.copy(this.toWorld(v.position));
      this.controls.target.copy(this.toWorld(v.target));
      if (t >= 1) {
        this.flight = null;
        resolve();
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    for (const fn of this.frameListeners) fn();
  }
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
      m.dispose();
    }
  });
}
