import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { easeInOutCubic, lerpView, viewForBox } from '../scene/camera';
import type { BackgroundMode, CameraView, ModelRef, Vec3 } from '../scene/schema';
import { BVH_MIN_TRIANGLES, accelerateRaycasts, countTriangles } from './bvh';
import { setLoaderRenderer } from './loaders';
import { type DeviceInfo, type QualityLevel, type QualitySettings, chooseQuality, parseQualityLevel, pixelRatioFor } from './quality';
import { RenderScheduler } from './renderScheduler';

export const CHROMA_GREEN = 0x00b140;

export interface PickResult {
  /** Surface point and normal in model-root space (what annotations store). */
  position: Vec3;
  normal?: Vec3;
}

type FrameListener = () => void;

const toVec3 = (v: THREE.Vector3): Vec3 => [round(v.x), round(v.y), round(v.z)];
const round = (n: number) => Math.round(n * 1e5) / 1e5;
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();

function deviceInfo(): DeviceInfo {
  return {
    devicePixelRatio: window.devicePixelRatio || 1,
    coarsePointer: !!window.matchMedia?.('(pointer: coarse)').matches,
    screenMin: Math.min(window.screen?.width || innerWidth, window.screen?.height || innerHeight),
  };
}

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
  private scheduler: RenderScheduler;
  private afterRender: (() => void)[] = [];
  private device = deviceInfo();
  private qualityLevel: QualityLevel;
  readonly quality: QualitySettings;
  /** Container size in CSS px, cached on resize so per-frame pin projection never forces a layout. */
  readonly viewport = { width: 0, height: 0 };
  /** Triangles of the current model, and whether raycasts against it are cheap (small, or BVH built). */
  modelTriangles = 0;
  raycastReady = true;
  private onVisibility = () => this.scheduler.setHidden(document.hidden);

  constructor(private container: HTMLElement) {
    this.qualityLevel = parseQualityLevel(new URLSearchParams(location.search).get('quality'));
    this.quality = chooseQuality(this.device, this.qualityLevel);
    // No preserveDrawingBuffer: the canvas keeps showing its last frame while idle anyway, and
    // screenshot() renders right before reading pixels. Preserving costs a copy per frame on
    // tile-based (phone) GPUs.
    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality.antialias, alpha: true });
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.quality.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    // The sun and the model stand still while the camera orbits: redraw the shadow map only when the
    // scene changes (requestRender), not on every camera frame. Halves the vertex work per frame.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    container.appendChild(this.renderer.domElement);
    setLoaderRenderer(this.renderer);
    this.scheduler = new RenderScheduler((on) => this.renderer.setAnimationLoop(on ? (t) => this.tick(t) : null));

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
    // Pointer, wheel and key input move the camera through the controls; damping continues in tick().
    this.controls.addEventListener('change', () => this.scheduler.request());

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 4, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -1.5;
    sun.shadow.camera.right = sun.shadow.camera.top = 1.5;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x444444, 0.6));

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.22 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground, this.modelRoot);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    // Hidden tabs get no animation frames anyway; this also stops the loop so nothing is owed.
    document.addEventListener('visibilitychange', this.onVisibility);
    this.scheduler.setHidden(document.hidden);
    this.requestRender();
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }

  /**
   * Draws the next frame. The viewer renders on demand: its own methods (setModel, setView,
   * applyTransform, setBackground, resize, controls input, flights) call this; code that changes the
   * scene graph directly must call it too. `shadows: false` skips redrawing the shadow map (only the
   * camera or DOM overlays changed).
   */
  requestRender(opts: { shadows?: boolean } = {}): void {
    if (opts.shadows !== false) this.renderer.shadowMap.needsUpdate = true;
    this.scheduler.request();
  }

  /** Frames drawn so far (benchmarks and tests). */
  get renderCount(): number {
    return this.scheduler.renders;
  }

  /** True while the render loop runs (a frame is owed or the camera is moving); false when idle. */
  get rendering(): boolean {
    return this.scheduler.active;
  }

  /** Listeners run after every drawn frame (pin projection); they get no calls while the stage is idle. */
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
    this.requestRender({ shadows: false });
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
    this.applyTransform(ref);
    this.modelTriangles = countTriangles(object);
    this.raycastReady = this.modelTriangles < BVH_MIN_TRIANGLES * 4;
    const pixelRatio = pixelRatioFor(this.quality, this.device, this.modelTriangles, this.qualityLevel);
    if (pixelRatio !== this.renderer.getPixelRatio()) {
      this.renderer.setPixelRatio(pixelRatio);
      this.resize();
    }
    // A texture that finishes decoding during the first frame is uploaded on the second.
    this.scheduler.request(2);
    // Picking/occlusion acceleration is built once the model is on screen, not before.
    this.afterNextRender(() => setTimeout(() => this.accelerate(object), 0));
  }

  private accelerate(object: THREE.Object3D): void {
    if (object.parent !== this.modelRoot) return;
    accelerateRaycasts(object)
      .then(({ built, ms }) => {
        if (built) console.info(`BVH: ${built} mesh(es) in ${ms.toFixed(0)} ms`);
        if (object.parent !== this.modelRoot) return;
        this.raycastReady = true;
        // Pins re-run their occlusion checks now that they are cheap.
        this.requestRender({ shadows: false });
      })
      .catch((err) => console.warn('BVH build failed; picking stays brute force.', err));
  }

  applyTransform(ref: ModelRef): void {
    this.modelRoot.scale.setScalar(ref.scale ?? 1);
    this.modelRoot.rotation.set(...(ref.rotation ?? [0, 0, 0]));
    this.modelRoot.position.set(...(ref.offset ?? [0, 0, 0]));
    this.modelRoot.updateMatrixWorld(true);
    this.requestRender();
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
    const box = this.boundsOf();
    return box ? this.viewOfBounds(box) : { position: [1.6, 0.9, 2.2], target: [0, 0.5, 0] };
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
    this.requestRender({ shadows: false });
  }

  flyTo(view: CameraView, duration = 900): Promise<void> {
    this.cancelFlight();
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.setView(view);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.flight = { from: this.getView(), to: view, start: performance.now(), duration, resolve };
      this.requestRender({ shadows: false });
    });
  }

  /** Raycasts the model under a client-space point. */
  pick(clientX: number, clientY: number): PickResult | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.params.Points.threshold = 0.01;
    const hit = this.firstHit(this.modelRoot);
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
    const hit = this.firstHit(part);
    if (!hit) return { position: this.toModel(center) };
    const normal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld);
    return { position: this.toModel(hit.point), normal: normal ? toVec3(normal) : undefined };
  }

  /** True when something on the model sits between the camera and this model-space point. */
  isOccluded(position: Vec3): boolean {
    const world = _v.set(position[0], position[1], position[2]).applyMatrix4(this.modelRoot.matrixWorld);
    const dir = _dir.copy(world).sub(this.camera.position);
    const dist = dir.length();
    this.raycaster.set(this.camera.position, dir.normalize());
    this.raycaster.far = dist;
    const hit = this.firstHit(this.modelRoot);
    this.raycaster.far = Infinity;
    return !!hit && hit.distance < dist - Math.max(0.01, dist * 0.01);
  }

  /** Projects a model-space point to container pixels; null when behind the camera. */
  project(position: Vec3): { x: number; y: number } | null {
    const out = { x: 0, y: 0 };
    return this.projectInto(position, out) ? out : null;
  }

  /** Allocation-free project() for per-frame use; false when the point is behind the camera. */
  projectInto(position: Vec3, out: { x: number; y: number }): boolean {
    const v = _v.set(position[0], position[1], position[2]).applyMatrix4(this.modelRoot.matrixWorld).project(this.camera);
    if (v.z > 1) return false;
    out.x = ((v.x + 1) / 2) * this.viewport.width;
    out.y = ((1 - v.y) / 2) * this.viewport.height;
    return true;
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

  /** Closest hit under the raycaster (meshes with a BVH stop at the first hit instead of sorting all). */
  private firstHit(object: THREE.Object3D): THREE.Intersection | undefined {
    (this.raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    return this.raycaster.intersectObject(object, true)[0];
  }

  private afterNextRender(fn: () => void): void {
    this.afterRender.push(fn);
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
    this.viewport.width = w;
    this.viewport.height = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.requestRender({ shadows: false });
  }

  private tick(now: number): void {
    let moving = false;
    if (this.flight) {
      moving = true;
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
    // update() returns true while the camera still moves (input, damping, a flight step).
    if (this.controls.update()) moving = true;
    if (!this.scheduler.frame(moving)) return;
    this.renderer.render(this.scene, this.camera);
    for (const fn of this.frameListeners) fn();
    if (this.afterRender.length) for (const fn of this.afterRender.splice(0)) fn();
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
