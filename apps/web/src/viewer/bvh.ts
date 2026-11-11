import type * as THREE from 'three';

/** Meshes below this many triangles are cheap enough to raycast brute force. */
export const BVH_MIN_TRIANGLES = 5000;

let impl: Promise<typeof import('./bvhImpl')> | null = null;

/**
 * Builds bounding volume hierarchies (three-mesh-bvh, a lazy chunk) for the big meshes under `root`,
 * so picking and the pins' occlusion rays cost well under a millisecond instead of ~150 ms on a
 * 1M-triangle capture.
 */
export async function accelerateRaycasts(root: THREE.Object3D, minTriangles = BVH_MIN_TRIANGLES): Promise<{ built: number; ms: number }> {
  impl ??= import('./bvhImpl');
  const { buildBoundsTrees } = await impl;
  const t = performance.now();
  const built = await buildBoundsTrees(root, minTriangles);
  return { built, ms: performance.now() - t };
}

/** Triangles drawn by the meshes under `root` (points and lines excluded). */
export function countTriangles(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    n += (g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0)) / 3;
  });
  return Math.round(n);
}
