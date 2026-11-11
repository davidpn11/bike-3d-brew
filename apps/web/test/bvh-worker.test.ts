import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Runs the real bvh.worker.ts in-process: a fake Worker hands messages to the module's
// `self.onmessage`, and the module's `postMessage` back to the fake's `onmessage`.
type Handler = ((e: { data: unknown }) => void) | null;

async function installFakeWorker(opts: { crash?: boolean } = {}) {
  const scope: { onmessage: Handler; postMessage: (data: unknown) => void } = { onmessage: null, postMessage: () => {} };
  vi.stubGlobal('self', scope);
  vi.resetModules();
  await import('../src/viewer/bvh.worker');
  const created: FakeWorker[] = [];
  class FakeWorker {
    onmessage: Handler = null;
    onerror: ((e: { message: string }) => void) | null = null;
    terminated = false;
    constructor() {
      created.push(this);
      scope.postMessage = (data) => queueMicrotask(() => this.onmessage?.({ data }));
    }
    postMessage(data: unknown) {
      if (opts.crash) queueMicrotask(() => this.onerror?.({ message: '' }));
      else queueMicrotask(() => scope.onmessage?.({ data }));
    }
    terminate() {
      this.terminated = true;
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  const impl = await import('../src/viewer/bvhImpl');
  return { impl, created };
}

// ~65k indexed triangles: above WORKER_MIN_TRIANGLES.
const bigMesh = () => new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), new THREE.MeshBasicMaterial());

function hitDistance(mesh: THREE.Mesh): number | undefined {
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
  return ray.intersectObject(mesh)[0]?.distance;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BVH worker', () => {
  it('builds big indexed meshes in the worker and keeps raycasts correct', async () => {
    const { impl, created } = await installFakeWorker();
    const mesh = bigMesh();
    const before = hitDistance(mesh);
    expect(await impl.buildBoundsTrees(mesh, 1000)).toBe(1);
    expect(created).toHaveLength(1);
    expect(mesh.geometry.boundsTree).toBeDefined();
    expect(mesh.geometry.index).not.toBeNull(); // the caller's index stays untouched
    expect(hitDistance(mesh)).toBeCloseTo(before!, 5);
    // A second mesh reuses the same worker.
    await impl.buildBoundsTrees(bigMesh(), 1000);
    expect(created).toHaveLength(1);
  });

  it('falls back to the main thread when the worker reports an error', async () => {
    const { impl } = await installFakeWorker();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scope = (globalThis as unknown as { self: { onmessage: Handler; postMessage: (d: unknown) => void } }).self;
    scope.onmessage = (e) => scope.postMessage({ id: (e.data as { id: number }).id, error: 'boom' });
    const mesh = bigMesh();
    expect(await impl.buildBoundsTrees(mesh, 1000)).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('BVH worker failed'), expect.any(Error));
    expect(mesh.geometry.boundsTree).toBeDefined();
  });

  it('recovers from a crashed worker with a fresh one', async () => {
    const { impl, created } = await installFakeWorker({ crash: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mesh = bigMesh();
    expect(await impl.buildBoundsTrees(mesh, 1000)).toBe(1);
    expect(mesh.geometry.boundsTree).toBeDefined();
    expect(created[0].terminated).toBe(true);
    await impl.buildBoundsTrees(bigMesh(), 1000);
    expect(created).toHaveLength(2);
  });

  it('builds non-indexed and small meshes on the main thread', async () => {
    const { impl, created } = await installFakeWorker();
    const flat = new THREE.Mesh(bigMesh().geometry.toNonIndexed(), new THREE.MeshBasicMaterial());
    const small = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const root = new THREE.Group().add(flat, small);
    expect(await impl.buildBoundsTrees(root, 10)).toBe(2);
    expect(created).toHaveLength(0);
    expect(flat.geometry.boundsTree && small.geometry.boundsTree).toBeDefined();
  });

  it('reports worker-side failures as error messages', async () => {
    const scope: { onmessage: Handler; postMessage: (d: unknown) => void } = { onmessage: null, postMessage: vi.fn() };
    vi.stubGlobal('self', scope);
    vi.resetModules();
    await import('../src/viewer/bvh.worker');
    scope.onmessage?.({ data: { id: 7, position: null, index: null, groups: [] } });
    expect(scope.postMessage).toHaveBeenCalledWith({ id: 7, error: expect.any(String) });
  });
});
