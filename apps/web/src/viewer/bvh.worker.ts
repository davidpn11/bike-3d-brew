// Builds a three-mesh-bvh hierarchy off the main thread: ~1 s of work for a 1M-triangle capture
// that would otherwise freeze orbiting right after the model appears.

/// <reference lib="webworker" />
import { BufferAttribute, BufferGeometry } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export interface BvhRequest {
  id: number;
  position: Float32Array;
  index: Uint32Array | Uint16Array | null;
  groups: { start: number; count: number; materialIndex?: number }[];
}

self.onmessage = (e: MessageEvent<BvhRequest>) => {
  const { id, position, index, groups } = e.data;
  try {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    if (index) geometry.setIndex(new BufferAttribute(index, 1));
    for (const g of groups) geometry.addGroup(g.start, g.count, g.materialIndex);
    // Indirect: the BVH keeps its own triangle order, so the caller's index buffer (already on the
    // GPU) stays untouched and the result can be attached to the original geometry.
    const bvh = new MeshBVH(geometry, { indirect: true });
    const { roots, indirectBuffer } = MeshBVH.serialize(bvh, { cloneBuffers: false });
    const transfer = [...roots, ...(indirectBuffer ? [indirectBuffer.buffer] : [])] as Transferable[];
    (self as unknown as Worker).postMessage({ id, roots, indirectBuffer }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
