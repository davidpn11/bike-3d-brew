import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { easeInOutCubic, lerpView, viewForBox } from '../scene/camera';
import type { BackgroundMode, CameraView, ModelRef, Vec3 } from '../scene/schema';

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

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    this.applyTransform(ref);
  }

  applyTransform(ref: ModelRef): void {
    this.modelRoot.scale.setScalar(ref.scale ?? 1);
    this.modelRoot.rotation.set(...(ref.rotation ?? [0, 0, 0]));
    this.modelRoot.position.set(...(ref.offset ?? [0, 0, 0]));
    this.modelRoot.updateMatrixWorld(true);
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
    const hit = this.raycaster.intersectObject(this.modelRoot, true)[0];
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
    const hit = this.raycaster.intersectObject(this.modelRoot, true)[0];
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
