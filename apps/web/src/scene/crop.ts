// Crop box helpers: pure math in model-root space (see CropBox in schema.ts), unit-tested.
// The viewer turns a box into six clipping planes; this file decides where a good box is.

import type { CropBox, Vec3 } from './schema';

export type Box = Pick<CropBox, 'min' | 'max'>;

export interface SuggestOptions {
  /** World up expressed in model-root space; the nearest model-root axis is treated as up. Default +Y. */
  up?: Vec3;
  maxSamples?: number;
  /** Margin around the kept cluster, as a fraction of its largest side. */
  padding?: number;
}

export interface CropSuggestion extends Box {
  /** Height (model-root units along the up axis) of the detected floor top, or null without one. */
  floor: number | null;
  /** Fraction of the sampled points inside the suggested box. */
  kept: number;
}

export function insideBox(box: Box, x: number, y: number, z: number): boolean {
  return x >= box.min[0] && x <= box.max[0] && y >= box.min[1] && y <= box.max[1] && z >= box.min[2] && z <= box.max[2];
}

/** The box with face `axis`/`side` moved to `value`, never letting it cross the opposite face. */
export function moveFace(box: Box, axis: 0 | 1 | 2, side: 'min' | 'max', value: number, minSize = 1e-3): Box {
  const min = [...box.min] as Vec3;
  const max = [...box.max] as Vec3;
  if (side === 'min') min[axis] = Math.min(value, max[axis] - minSize);
  else max[axis] = Math.max(value, min[axis] + minSize);
  return { min, max };
}

/** Grows a box by a margin on every side (the "show everything" starting box). */
export function padBox(box: Box, fraction: number): Box {
  const size = Math.max(...box.max.map((v, i) => v - box.min[i]));
  const m = size * fraction;
  return { min: box.min.map((v) => round(v - m)) as Vec3, max: box.max.map((v) => round(v + m)) as Vec3 };
}

/**
 * "Fit to bike": a box around the bike in an area-mode (or messy object-mode) scan.
 *  1. The floor is a dense, wide slab of points near the bottom of the up axis: cut just above it.
 *  2. What remains is split into connected clusters on a coarse voxel grid (64 cells on the
 *     longest side, 26-neighbourhood). Walls, furniture and floaters end up in other clusters.
 *  3. The biggest cluster (by point count) is the bike; the box hugs it with a small margin and
 *     sits on the floor cut, so tyres keep their contact patch.
 * Returns null for degenerate input.
 */
export function suggestCrop(positions: ArrayLike<number>, opts: SuggestOptions = {}): CropSuggestion | null {
  const { up = [0, 1, 0], maxSamples = 120_000, padding = 0.02 } = opts;
  const upAxis = [0, 1, 2].reduce((best, i) => (Math.abs(up[i]) > Math.abs(up[best]) ? i : best), 0);
  const upSign = up[upAxis] < 0 ? -1 : 1;
  const [ua, va] = [0, 1, 2].filter((i) => i !== upAxis);

  // Gather a strided sample as (u, h, v): h is height along the up axis.
  const n = Math.floor(positions.length / 3);
  const stride = Math.max(1, Math.ceil(n / maxSamples));
  const pts = new Float64Array(Math.ceil(n / stride) * 3);
  let count = 0;
  for (let i = 0; i < n; i += stride) {
    const u = positions[i * 3 + ua];
    const h = positions[i * 3 + upAxis] * upSign;
    const v = positions[i * 3 + va];
    if (!Number.isFinite(u) || !Number.isFinite(h) || !Number.isFinite(v)) continue;
    pts[count * 3] = u;
    pts[count * 3 + 1] = h;
    pts[count * 3 + 2] = v;
    count++;
  }
  if (count < 8) return null;
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      const c = pts[i * 3 + k];
      if (c < lo[k]) lo[k] = c;
      if (c > hi[k]) hi[k] = c;
    }
  }
  const size = hi.map((v, k) => v - lo[k]);
  if (Math.max(...size) <= 0) return null;

  const floor = detectFloor(pts, count, lo, hi);
  const cut = floor ?? -Infinity;

  // Voxel clusters above the floor.
  const RES = 64;
  const cell = Math.max(...size) / RES; // > 0: checked above
  const dims = size.map((s) => Math.max(1, Math.min(RES + 1, Math.floor(s / cell) + 1)));
  const [nx, ny, nz] = dims;
  const occ = new Int32Array(nx * ny * nz);
  const voxelOf = (i: number) => {
    const x = Math.min(nx - 1, Math.floor((pts[i * 3] - lo[0]) / cell));
    const y = Math.min(ny - 1, Math.floor((pts[i * 3 + 1] - lo[1]) / cell));
    const z = Math.min(nz - 1, Math.floor((pts[i * 3 + 2] - lo[2]) / cell));
    return x + nx * (y + ny * z);
  };
  let above = 0;
  for (let i = 0; i < count; i++) {
    if (pts[i * 3 + 1] <= cut) continue;
    occ[voxelOf(i)]++;
    above++;
  }
  if (above < 8) return null;
  const label = new Int32Array(occ.length).fill(-1);
  const queue = new Int32Array(occ.length);
  let best = -1;
  let bestCount = 0;
  let next = 0;
  for (let start = 0; start < occ.length; start++) {
    if (!occ[start] || label[start] >= 0) continue;
    const id = next++;
    let head = 0;
    let tail = 0;
    let total = 0;
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      const c = queue[head++];
      total += occ[c];
      const x = c % nx;
      const y = Math.floor(c / nx) % ny;
      const z = Math.floor(c / (nx * ny));
      for (let dz = -1; dz <= 1; dz++) {
        const zz = z + dz;
        if (zz < 0 || zz >= nz) continue;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= ny) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= nx) continue;
            const nb = xx + nx * (yy + ny * zz);
            if (occ[nb] && label[nb] < 0) {
              label[nb] = id;
              queue[tail++] = nb;
            }
          }
        }
      }
    }
    if (total > bestCount) {
      bestCount = total;
      best = id;
    }
  }

  const bmin: Vec3 = [Infinity, Infinity, Infinity];
  const bmax: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    if (pts[i * 3 + 1] <= cut || label[voxelOf(i)] !== best) continue;
    for (let k = 0; k < 3; k++) {
      const c = pts[i * 3 + k];
      if (c < bmin[k]) bmin[k] = c;
      if (c > bmax[k]) bmax[k] = c;
    }
  }
  const pad = Math.max(...bmax.map((v, k) => v - bmin[k])) * padding;
  for (let k = 0; k < 3; k++) {
    bmin[k] -= pad;
    bmax[k] += pad;
  }
  if (floor !== null) bmin[1] = Math.max(bmin[1], floor);

  // Back from (u, h, v) to model-root axes.
  const min = [0, 0, 0] as Vec3;
  const max = [0, 0, 0] as Vec3;
  min[ua] = bmin[0];
  max[ua] = bmax[0];
  min[va] = bmin[2];
  max[va] = bmax[2];
  if (upSign > 0) {
    min[upAxis] = bmin[1];
    max[upAxis] = bmax[1];
  } else {
    min[upAxis] = -bmax[1];
    max[upAxis] = -bmin[1];
  }
  const box: Box = { min: min.map(round) as Vec3, max: max.map(round) as Vec3 };
  let kept = 0;
  for (let i = 0; i < n; i += stride) if (insideBox(box, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])) kept++;
  return { ...box, floor: floor === null ? null : round(floor * upSign), kept: kept / count };
}

/**
 * Top of a floor slab, or null. A floor is a height band in the lower third holding many points
 * spread over most of the scan's footprint; tyre contact patches are neither dense nor wide.
 */
function detectFloor(pts: Float64Array, count: number, lo: Vec3, hi: Vec3): number | null {
  const BINS = 256;
  const span = hi[1] - lo[1];
  if (span <= 0) return null;
  const bin = span / BINS;
  const hist = new Int32Array(BINS);
  for (let i = 0; i < count; i++) hist[Math.min(BINS - 1, Math.floor((pts[i * 3 + 1] - lo[1]) / bin))]++;
  const lower = Math.ceil(BINS / 3);
  let peak = 0;
  for (let b = 1; b < lower; b++) if (hist[b] > hist[peak]) peak = b;
  if (hist[peak] < Math.max(20, count * 0.02)) return null;
  const nonzero = [...hist].filter((c) => c > 0).sort((a, b) => a - b);
  if (hist[peak] < 4 * nonzero[Math.floor(nonzero.length / 2)]) return null;
  // Wide: the peak band's footprint covers a good part of the scan's footprint.
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (let i = 0; i < count; i++) {
    if (Math.min(BINS - 1, Math.floor((pts[i * 3 + 1] - lo[1]) / bin)) !== peak) continue;
    u0 = Math.min(u0, pts[i * 3]);
    u1 = Math.max(u1, pts[i * 3]);
    v0 = Math.min(v0, pts[i * 3 + 2]);
    v1 = Math.max(v1, pts[i * 3 + 2]);
  }
  const footprint = (hi[0] - lo[0]) * (hi[2] - lo[2]);
  if (footprint <= 0 || ((u1 - u0) * (v1 - v0)) / footprint < 0.3) return null;
  // A slab has a top and a bottom face (and noise): the floor top is the highest dense band.
  let top = peak;
  for (let b = peak + 1; b < lower; b++) if (hist[b] >= hist[peak] * 0.25) top = b;
  return lo[1] + (top + 1) * bin;
}

const round = (n: number) => Math.round(n * 1e5) / 1e5 + 0;
