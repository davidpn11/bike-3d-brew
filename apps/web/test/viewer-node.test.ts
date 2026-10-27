import { zipSync } from 'fflate';
import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildFixtures } from '../../../tools/fixtures/make-capture-bundle.mjs';
import { DEMO_HOTSPOTS, DEMO_PARTS, createDemoBike } from '../src/viewer/demoBike';
import { ModelLoadError, centerOnGround, loadModel } from '../src/viewer/loaders';

// three.js code that runs without WebGL: model loading, centering and the procedural demo bike.

const dataUrl = (bytes: Uint8Array | string, mime = 'application/octet-stream') =>
  `data:${mime};base64,${Buffer.from(typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes).toString('base64')}`;

const boxOf = (o: THREE.Object3D) => {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
};

// three's FileLoader reports download progress with the DOM's ProgressEvent, which Node lacks.
class NodeProgressEvent extends Event {
  constructor(
    type: string,
    readonly init: { lengthComputable?: boolean; loaded?: number; total?: number } = {},
  ) {
    super(type);
  }
}

let fixtures: Record<string, Uint8Array>;
beforeAll(async () => {
  globalThis.ProgressEvent ??= NodeProgressEvent as unknown as typeof ProgressEvent;
  fixtures = await buildFixtures();
});
afterEach(() => vi.restoreAllMocks());

describe('createDemoBike', () => {
  const bike = createDemoBike();

  it('has every named part the default areas are derived from', () => {
    for (const part of DEMO_PARTS) expect(bike.getObjectByName(part), part).toBeDefined();
    for (const { part } of DEMO_HOTSPOTS) expect(DEMO_PARTS).toContain(part);
  });

  it('is a road-bike-sized object standing on the ground, facing +X', () => {
    const size = boxOf(bike).getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(1.5);
    expect(size.x).toBeLessThan(1.9);
    expect(size.y).toBeGreaterThan(0.95);
    expect(size.y).toBeLessThan(1.1);
    expect(boxOf(bike).min.y).toBeCloseTo(0, 1);
    const front = boxOf(bike.getObjectByName('front-wheel')!).getCenter(new THREE.Vector3());
    const rear = boxOf(bike.getObjectByName('rear-wheel')!).getCenter(new THREE.Vector3());
    expect(front.x).toBeGreaterThan(rear.x);
    // Wheels are 700c-ish: ~0.69 m across.
    expect(boxOf(bike.getObjectByName('front-wheel')!).getSize(new THREE.Vector3()).y).toBeCloseTo(0.69, 1);
  });

  it('runs the drivetrain from the bottom bracket to the rear axle, and every mesh casts shadows', () => {
    const drive = boxOf(bike.getObjectByName('drivetrain')!);
    expect(drive.min.x).toBeLessThan(-0.5);
    expect(drive.max.x).toBeGreaterThan(0);
    bike.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) expect(o.castShadow).toBe(true);
    });
  });
});

describe('centerOnGround', () => {
  it('centers X/Z and rests the model on y=0 without touching its scale', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4));
    mesh.position.set(5, 3, -2);
    const wrapped = centerOnGround(mesh);
    expect(wrapped.name).toBe('centered');
    const box = boxOf(wrapped);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(0);
    expect(box.getCenter(new THREE.Vector3()).z).toBeCloseTo(0);
    expect(box.getSize(new THREE.Vector3()).toArray()).toEqual([2, 1, 4]);
  });

  it('is deterministic and leaves empty models alone', () => {
    const a = centerOnGround(createDemoBike());
    const b = centerOnGround(createDemoBike());
    expect(boxOf(a).equals(boxOf(b))).toBe(true);
    const empty = new THREE.Group();
    centerOnGround(empty);
    expect(empty.position.toArray()).toEqual([0, 0, 0]);
  });
});

describe('loadModel', () => {
  it('builds the demo bike', async () => {
    const demo = await loadModel('demo:road', 'demo');
    expect(demo.name).toBe('demo-bike');
  });

  it('loads the fixture USDZ and GLB', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}); // USDZLoader deprecation notice
    const usdz = await loadModel(dataUrl(fixtures['bike.usdz']), 'usdz');
    expect(boxOf(usdz).getSize(new THREE.Vector3()).x).toBeGreaterThan(1.5);
    const glb = await loadModel(dataUrl(fixtures['bike.glb']), 'glb');
    expect(glb.getObjectByName('frame')).toBeDefined();
  });

  it('turns PLY faces into a mesh and bare vertices into points', async () => {
    const header = (faces: number) =>
      ['ply', 'format ascii 1.0', 'element vertex 3', 'property float x', 'property float y', 'property float z', 'property uchar red', 'property uchar green', 'property uchar blue', `element face ${faces}`, 'property list uchar int vertex_indices', 'end_header'].join('\n');
    const verts = '0 0 0 255 0 0\n1 0 0 0 255 0\n0 1 0 0 0 255\n';
    const mesh = (await loadModel(dataUrl(`${header(1)}\n${verts}3 0 1 2\n`), 'ply')) as THREE.Mesh;
    expect(mesh.isMesh).toBe(true);
    expect(mesh.geometry.hasAttribute('normal')).toBe(true);
    expect((mesh.material as THREE.MeshStandardMaterial).vertexColors).toBe(true);
    const points = (await loadModel(dataUrl(`${header(0)}\n${verts}`), 'ply')) as THREE.Points;
    expect(points.isPoints).toBe(true);
  });

  it('wraps loader failures in a ModelLoadError that names the format', async () => {
    const err = await loadModel(dataUrl('not a glb'), 'glb').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelLoadError);
    expect((err as Error).message).toMatch(/^Could not load GLB model/);
  });

  it('explains USDZ files three.js cannot read meshes from', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const empty = zipSync({ 'empty.usda': new TextEncoder().encode('#usda 1.0\n(\n    defaultPrim = "Root"\n)\n\ndef Xform "Root"\n{\n}\n') }, { level: 0 });
    await expect(loadModel(dataUrl(empty), 'usdz')).rejects.toThrow(/usdz-to-glb/);
  });
});
