import { type NumArray, USDComposer } from 'three/examples/jsm/loaders/usd/USDComposer.js';

/** Marks a triangulation pattern that maps every face-vertex to itself (all-triangle mesh). */
const IDENTITY = Symbol('identity');
type Pattern = NumArray & { [IDENTITY]?: true };

/**
 * USDComposer with typed-array fast paths. Object Capture meshes are already triangulated and
 * large (10⁵–10⁶ triangles); three's generic path pushes every index into plain JS arrays, which
 * took ~2 s for a 1M-triangle capture versus ~0.2 s here. Results are identical.
 */
export class FastUSDComposer extends USDComposer {
  protected override _triangulateIndicesWithPattern(
    indices: NumArray,
    counts: NumArray,
    points?: NumArray | null,
    holeMap?: { holeFaces: Set<number>; parentToHoles: Map<number, number[]> } | null,
  ): { indices: NumArray; pattern: NumArray } {
    const hasHoles = !!holeMap && (holeMap.holeFaces.size > 0 || holeMap.parentToHoles.size > 0);
    if (hasHoles || indices.length !== counts.length * 3 || !allEqual(counts, 3)) return super._triangulateIndicesWithPattern(indices, counts, points, holeMap);
    const pattern = new Uint32Array(indices.length);
    for (let i = 0; i < pattern.length; i++) pattern[i] = i;
    return { indices, pattern: Object.assign(pattern, { [IDENTITY]: true as const }) };
  }

  protected override _applyTriangulationPattern(indices: NumArray, pattern: Pattern): NumArray {
    if (pattern[IDENTITY] && indices.length === pattern.length) return indices;
    const out = new Int32Array(pattern.length);
    for (let i = 0; i < pattern.length; i++) out[i] = indices[pattern[i]];
    return out;
  }

  protected override _expandAttribute(data: NumArray, indices: NumArray, itemSize: number): NumArray {
    const out = new Float32Array(indices.length * itemSize);
    for (let i = 0; i < indices.length; i++) {
      const src = indices[i] * itemSize;
      for (let j = 0; j < itemSize; j++) out[i * itemSize + j] = data[src + j];
    }
    return out;
  }
}

function allEqual(a: NumArray, v: number): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== v) return false;
  return true;
}
