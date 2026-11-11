import * as THREE from 'three';
import { MeshBVH, type SerializedBVH, acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import type { BvhRequest } from './bvh.worker';

// Meshes without a bounds tree fall back to three's own raycast, so patching every mesh is safe.
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/** Above this many triangles the BVH is built in a worker (when there is one) instead of on the main thread. */
export const WORKER_MIN_TRIANGLES = 50_000;

/** Builds a BVH for every mesh with at least `minTriangles`; resolves with how many were built. */
export async function buildBoundsTrees(root: THREE.Object3D, minTriangles: number): Promise<number> {
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || mesh.geometry.boundsTree || !mesh.geometry.getAttribute('position')) return;
    if (triangleCount(mesh.geometry) >= minTriangles) geometries.add(mesh.geometry);
  });
  for (const g of geometries) {
    if (typeof Worker !== 'undefined' && triangleCount(g) >= WORKER_MIN_TRIANGLES && workerFriendly(g)) {
      try {
        await buildInWorker(g);
        continue;
      } catch (err) {
        console.warn('BVH worker failed; building on the main thread.', err);
      }
    }
    computeBoundsTree.call(g);
  }
  return geometries.size;
}

function triangleCount(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}

function workerFriendly(g: THREE.BufferGeometry): boolean {
  const pos = g.getAttribute('position');
  // Interleaved attributes have no plain array of their own to copy.
  return !!g.index && !(pos as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && pos.array instanceof Float32Array && pos.array.length === pos.count * 3;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (d: SerializedBVH) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./bvh.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<{ id: number; error?: string; roots: ArrayBuffer[]; indirectBuffer: Uint32Array | Uint16Array | null }>) => {
    const { id, error, roots, indirectBuffer } = e.data;
    const task = pending.get(id);
    pending.delete(id);
    if (error) task?.reject(new Error(error));
    else task?.resolve({ version: 1, roots, index: null, indirectBuffer } as SerializedBVH);
  };
  w.onerror = (e) => {
    for (const task of pending.values()) task.reject(new Error(e.message || 'BVH worker crashed'));
    pending.clear();
    worker = null;
    w.terminate();
  };
  return (worker = w);
}

/** Copies (never transfers: the geometry stays usable) position + index to the worker and attaches the result. */
async function buildInWorker(g: THREE.BufferGeometry): Promise<void> {
  const position = (g.getAttribute('position').array as Float32Array).slice();
  const index = g.index!.array.slice() as Uint32Array | Uint16Array;
  const id = ++nextId;
  const request: BvhRequest = { id, position, index, groups: g.groups.map(({ start, count, materialIndex }) => ({ start, count, materialIndex })) };
  const data = await new Promise<SerializedBVH>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage(request, [position.buffer, index.buffer]);
  });
  g.boundsTree = MeshBVH.deserialize(data, g, { setIndex: false });
}
