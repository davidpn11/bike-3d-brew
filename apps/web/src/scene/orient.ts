// Auto-orientation of scanned bikes. Pure math on vertex positions (no three.js), so it is
// unit-tested against synthetic bikes in arbitrary poses.
//
// Target frame (same as the demo bike): +X = front, +Y = up, +Z = drive side (right),
// ground at y = 0. A bike is a long, tall-ish, thin object: PCA's smallest-variance axis is
// its width, the largest its length. Object Capture already keeps +Y up, so when Y is a
// plausible up axis we only fix yaw; otherwise the side-view silhouette's ground line (the
// tangent across both tyres) gives the exact up direction. Remaining sign ambiguities are
// resolved with bike-shaped heuristics (wheels make the bottom heavy and narrow, the bars
// make the top wide and sit at the front); the Edit → Model buttons fix what they get wrong.

import type { BikeScene, Vec3 } from './schema';

/** Row-major 3×3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface OrientOptions {
  /** Vertices actually inspected; larger inputs are strided. Keeps 1M-vertex meshes well under 50 ms. */
  maxSamples?: number;
  /** Keep +Y as the up axis when it is plausible (Object Capture output is gravity-aligned). */
  preferYUp?: boolean;
}

export interface OrientResult {
  /** Euler XYZ radians for `ModelRef.rotation` (three.js convention). */
  rotation: Vec3;
  matrix: Mat3;
  /** Source-space unit axes that end up as +X (front), +Y (up), +Z (right). */
  front: Vec3;
  up: Vec3;
  right: Vec3;
  /** True when the input's +Y (or -Y) was kept as the up axis and only yaw was changed. */
  keptUp: boolean;
  /** 0…1, how decisive the up / front sign heuristics were. */
  confidence: { up: number; front: number };
  samples: number;
}

const Y: Vec3 = [0, 1, 0];
// The ground-line estimate is accurate to ~1°, so a larger disagreement means the scan really is tilted.
const KEEP_UP_COS = Math.cos((6 * Math.PI) / 180);

/**
 * Estimates the rotation that stands a scanned bike upright with its length along +X.
 * `positions` is a flat xyz array (e.g. a BufferAttribute's array). Returns null for
 * degenerate input (too few points, all points coincident or on a line).
 */
export function estimateOrientation(positions: ArrayLike<number>, opts: OrientOptions = {}): OrientResult | null {
  const { maxSamples = 50_000, preferYUp = true } = opts;
  const n = Math.floor(positions.length / 3);
  if (n < 8) return null;
  const stride = Math.max(1, Math.ceil(n / maxSamples));
  const m = Math.ceil(n / stride);
  const pts = new Float64Array(m * 3);
  let k = 0;
  for (let i = 0; i < n; i += stride) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    pts[k++] = x;
    pts[k++] = y;
    pts[k++] = z;
  }
  const count = k / 3;
  if (count < 8) return null;

  const { mean, cov } = covariance(pts, count);
  const { values, vectors } = symmetricEigen(cov);
  if (values[0] <= 1e-12 || values[1] <= 1e-9 * values[0]) return null;
  const [, e2, e3] = vectors;

  // Candidate up: PCA's middle axis, sign from bike heuristics, refined to the ground line.
  let lateral = e3;
  let upSign = upSignScore(pts, count, mean, e2, lateral);
  let up = scale(e2, upSign.score >= 0 ? 1 : -1);
  up = refineUpFromGroundLine(pts, count, mean, up, lateral);

  let keptUp = false;
  if (preferYUp && Math.abs(dot(e3, Y)) < 0.35 && Math.abs(dot(up, Y)) > KEEP_UP_COS) {
    // Gravity-aligned capture: keep ±Y exactly, take the lateral axis from the horizontal spread.
    keptUp = true;
    up = dot(up, Y) >= 0 ? [0, 1, 0] : [0, -1, 0];
    lateral = horizontalMinorAxis(pts, count, mean);
    upSign = upSignScore(pts, count, mean, up, lateral);
  }
  // Orthonormal frame: right ⟂ up, front = up × right (so front × up = right, det = +1).
  lateral = normalize(sub(lateral, scale(up, dot(lateral, up))));
  let front = cross(up, lateral);
  const frontScore = frontSignScore(pts, count, mean, front, up, lateral);
  if (frontScore < 0) front = scale(front, -1);
  const right = cross(front, up);

  const matrix: Mat3 = [...front, ...up, ...right] as Mat3;
  // A pure yaw reads better in the scene JSON as [0, θ, 0] than its Euler twin [π, π−θ, π].
  const rotation: Vec3 = keptUp && up[1] > 0 ? [0, Math.round(Math.atan2(matrix[2], matrix[0]) * 1e6) / 1e6, 0] : eulerXYZFromMatrix(matrix);
  return {
    rotation,
    matrix,
    front: roundVec(front),
    up: roundVec(up),
    right: roundVec(right),
    keptUp,
    confidence: { up: Math.min(1, Math.abs(upSign.score)), front: Math.min(1, Math.abs(frontScore)) },
    samples: count,
  };
}

/** New captures (no comments yet, never oriented) are auto-oriented once on first load. */
export function shouldAutoOrient(scene: BikeScene): boolean {
  return scene.model.format !== 'demo' && scene.model.rotation === undefined && scene.annotations.length === 0;
}

// ---------------------------------------------------------------- heuristics

interface Band {
  lo: number;
  hi: number;
}

function extent(pts: Float64Array, count: number, mean: Vec3, axis: Vec3): Band {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < count; i++) {
    const t = proj(pts, i, mean, axis);
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  return { lo, hi };
}

/**
 * Positive when `up` points up. Three votes, each in [-1, 1]:
 * - mass: wheels (tyres, rims, spokes) put most of the surface low, so the centroid sits below mid-height;
 * - width: the bottom band is just two tyre contact patches, the top band holds the handlebar;
 * - ground: a bike's lowest hull edge (tyre to tyre) is longer than its highest (saddle to bars).
 */
function upSignScore(pts: Float64Array, count: number, mean: Vec3, up: Vec3, lateral: Vec3): { score: number } {
  const { lo, hi } = extent(pts, count, mean, up);
  const h = Math.max(hi - lo, 1e-12);
  // Centroid is at t = 0 (mean); mid-height is (lo + hi) / 2.
  const mass = clamp(((lo + hi) / 2 / h) * 6);
  let latTop = 0;
  let nTop = 0;
  let latBot = 0;
  let nBot = 0;
  let latMean = 0;
  for (let i = 0; i < count; i++) latMean += proj(pts, i, mean, lateral);
  latMean /= count;
  for (let i = 0; i < count; i++) {
    const t = (proj(pts, i, mean, up) - lo) / h;
    const l = proj(pts, i, mean, lateral) - latMean;
    if (t > 0.8) {
      latTop += l * l;
      nTop++;
    } else if (t < 0.2) {
      latBot += l * l;
      nBot++;
    }
  }
  const rTop = Math.sqrt(latTop / Math.max(nTop, 1));
  const rBot = Math.sqrt(latBot / Math.max(nBot, 1));
  const width = (rTop - rBot) / Math.max(rTop + rBot, 1e-12);
  return { score: 0.6 * mass + 0.8 * width };
}

/**
 * Positive when `front` points to the bike's front: the handlebar (the widest thing near the
 * top) sits ahead of centre, and the drivetrain's cassette/derailleur pull the centroid rearward.
 */
function frontSignScore(pts: Float64Array, count: number, mean: Vec3, front: Vec3, up: Vec3, lateral: Vec3): number {
  const { lo, hi } = extent(pts, count, mean, up);
  const len = extent(pts, count, mean, front);
  const h = Math.max(hi - lo, 1e-12);
  const L = Math.max(len.hi - len.lo, 1e-12);
  let latMean = 0;
  for (let i = 0; i < count; i++) latMean += proj(pts, i, mean, lateral);
  latMean /= count;
  let wSum = 0;
  let wx = 0;
  for (let i = 0; i < count; i++) {
    const t = (proj(pts, i, mean, up) - lo) / h;
    if (t < 0.65) continue;
    const l = proj(pts, i, mean, lateral) - latMean;
    const w = l * l;
    wSum += w;
    wx += w * proj(pts, i, mean, front);
  }
  const mid = (len.lo + len.hi) / 2;
  // The top band always holds the highest points, so wSum is only 0 for a perfectly flat top.
  const bars = clamp(((wx / Math.max(wSum, 1e-300) - mid) / L) * 4);
  const mass = clamp((mid / L) * 8); // centroid (t = 0) behind the middle → positive
  return bars + 0.25 * mass;
}

/**
 * Side-view refinement: the ground line is the long bottom edge of the silhouette's convex hull
 * (tangent across both tyres). PCA axes of a bike are typically tilted 5–15° from it.
 */
function refineUpFromGroundLine(pts: Float64Array, count: number, mean: Vec3, up: Vec3, lateral: Vec3): Vec3 {
  const along = normalize(cross(up, lateral));
  const hull = sideHull(pts, count, mean, along, up);
  // Stays [0, 1] (keep `up`) when no hull edge faces down within 40°.
  let bestLen = 0;
  let bestNormal: [number, number] = [0, 1];
  const maxTilt = Math.cos((40 * Math.PI) / 180);
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i];
    const [bx, by] = hull[(i + 1) % hull.length];
    const dx = bx - ax;
    const dy = by - ay;
    // Monotone chain drops duplicate and collinear points, so no edge has zero length.
    const len = Math.hypot(dx, dy);
    // Counter-clockwise hull: the outward normal is (dy, -dx). We want edges facing down (-up).
    const nx = dy / len;
    const ny = -dx / len;
    if (-ny < maxTilt) continue;
    if (len > bestLen) {
      bestLen = len;
      bestNormal = [-nx, -ny];
    }
  }
  return normalize(add(scale(along, bestNormal[0]), scale(up, bestNormal[1])));
}

/**
 * Convex hull (counter-clockwise) of the points projected on the (u, v) plane. Only the min/max
 * v of each of 1024 u-columns can be hull vertices (up to column width), so this is O(n).
 */
function sideHull(pts: Float64Array, count: number, mean: Vec3, u: Vec3, v: Vec3): [number, number][] {
  const COLS = 1024;
  const { lo, hi } = extent(pts, count, mean, u);
  const span = Math.max(hi - lo, 1e-12);
  const minV = new Float64Array(COLS).fill(Infinity);
  const maxV = new Float64Array(COLS).fill(-Infinity);
  const minU = new Float64Array(COLS);
  const maxU = new Float64Array(COLS);
  for (let i = 0; i < count; i++) {
    const a = proj(pts, i, mean, u);
    const b = proj(pts, i, mean, v);
    const c = Math.min(COLS - 1, Math.floor(((a - lo) / span) * COLS));
    if (b < minV[c]) {
      minV[c] = b;
      minU[c] = a;
    }
    if (b > maxV[c]) {
      maxV[c] = b;
      maxU[c] = a;
    }
  }
  const cand: [number, number][] = [];
  for (let c = 0; c < COLS; c++) {
    if (minV[c] === Infinity) continue;
    cand.push([minU[c], minV[c]], [maxU[c], maxV[c]]);
  }
  cand.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const crossZ = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of cand) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = cand.length - 1; i >= 0; i--) {
    const p = cand[i];
    while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Smallest-spread horizontal (XZ) direction: the bike's width when +Y is up. */
function horizontalMinorAxis(pts: Float64Array, count: number, mean: Vec3): Vec3 {
  let xx = 0;
  let xz = 0;
  let zz = 0;
  for (let i = 0; i < count; i++) {
    const x = pts[i * 3] - mean[0];
    const z = pts[i * 3 + 2] - mean[2];
    xx += x * x;
    xz += x * z;
    zz += z * z;
  }
  // Major-axis angle of the 2×2 covariance; the minor axis is perpendicular to it.
  const theta = 0.5 * Math.atan2(2 * xz, xx - zz);
  return [-Math.sin(theta), 0, Math.cos(theta)];
}

// ---------------------------------------------------------------- linear algebra

export function covariance(pts: Float64Array, count: number): { mean: Vec3; cov: Mat3 } {
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let i = 0; i < count; i++) {
    mx += pts[i * 3];
    my += pts[i * 3 + 1];
    mz += pts[i * 3 + 2];
  }
  mx /= count;
  my /= count;
  mz /= count;
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  for (let i = 0; i < count; i++) {
    const x = pts[i * 3] - mx;
    const y = pts[i * 3 + 1] - my;
    const z = pts[i * 3 + 2] - mz;
    xx += x * x;
    xy += x * y;
    xz += x * z;
    yy += y * y;
    yz += y * z;
    zz += z * z;
  }
  return { mean: [mx, my, mz], cov: [xx / count, xy / count, xz / count, xy / count, yy / count, yz / count, xz / count, yz / count, zz / count] };
}

/** Eigen-decomposition of a symmetric 3×3 matrix (cyclic Jacobi), eigenvalues descending. */
export function symmetricEigen(m: Mat3): { values: Vec3; vectors: [Vec3, Vec3, Vec3] } {
  const a = [
    [m[0], m[1], m[2]],
    [m[3], m[4], m[5]],
    [m[6], m[7], m[8]],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 32; sweep++) {
    const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2;
    if (off < 1e-30) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let r = 0; r < 3; r++) {
        const arp = a[r][p];
        const arq = a[r][q];
        a[r][p] = c * arp - s * arq;
        a[r][q] = s * arp + c * arq;
      }
      for (let r = 0; r < 3; r++) {
        const apr = a[p][r];
        const aqr = a[q][r];
        a[p][r] = c * apr - s * aqr;
        a[q][r] = s * apr + c * aqr;
      }
      for (let r = 0; r < 3; r++) {
        const vrp = v[r][p];
        const vrq = v[r][q];
        v[r][p] = c * vrp - s * vrq;
        v[r][q] = s * vrp + c * vrq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return {
    values: order.map((i) => a[i][i]) as Vec3,
    vectors: order.map((i) => normalize([v[0][i], v[1][i], v[2][i]])) as [Vec3, Vec3, Vec3],
  };
}

/** three.js Euler 'XYZ' from a rotation matrix (R = Rx · Ry · Rz). */
export function eulerXYZFromMatrix(r: Mat3): Vec3 {
  const [m11, m12, m13, , m22, m23, , m32, m33] = r;
  const y = Math.asin(Math.max(-1, Math.min(1, m13)));
  let x: number;
  let z: number;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-m23, m33);
    z = Math.atan2(-m12, m11);
  } else {
    x = Math.atan2(m32, m22);
    z = 0;
  }
  return roundVec([x, y, z], 1e6);
}

export function matrixFromEulerXYZ([x, y, z]: Vec3): Mat3 {
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;
  return [c * e, -c * f, d, af + be * d, ae - bf * d, -b * c, bf - ae * d, be + af * d, a * c];
}

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return out;
}

export function axisAngle(axis: 'x' | 'y' | 'z', angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (axis === 'x') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 'y') return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Applies a rotation about a world axis on top of an existing model rotation (Euler XYZ in, out). */
export function rotateAboutWorld(rotation: Vec3 | undefined, axis: 'x' | 'y' | 'z', angle: number): Vec3 {
  return eulerXYZFromMatrix(multiply(axisAngle(axis, angle), matrixFromEulerXYZ(rotation ?? [0, 0, 0])));
}

/** Angle in radians between two rotations (0 = identical). */
export function rotationDistance(a: Mat3, b: Mat3): number {
  // trace(aᵀ b) = 1 + 2 cos θ
  let tr = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) tr += a[r * 3 + c] * b[r * 3 + c];
  return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const clamp = (v: number) => Math.max(-1, Math.min(1, v));
function normalize(a: Vec3): Vec3 {
  const l = Math.max(Math.hypot(a[0], a[1], a[2]), 1e-300);
  return [a[0] / l, a[1] / l, a[2] / l];
}
const proj = (pts: Float64Array, i: number, mean: Vec3, axis: Vec3) =>
  (pts[i * 3] - mean[0]) * axis[0] + (pts[i * 3 + 1] - mean[1]) * axis[1] + (pts[i * 3 + 2] - mean[2]) * axis[2];
const roundVec = (v: Vec3, f = 1e6): Vec3 => v.map((n) => Math.round(n * f) / f + 0) as Vec3;
