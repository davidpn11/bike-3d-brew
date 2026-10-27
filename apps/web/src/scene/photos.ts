// Picks the capture photos that best show a point on the bike (an area's target or a comment's
// pin), using the camera poses Object Capture reports in poses.json.
//
// Spaces. A pose is a column-major 4×4 camera→reconstruction transform; the camera looks down
// its -Z with +Y up (three.js / ARKit convention). Scene positions (hotspot targets, comment
// pins) live in *model-root* space. The viewer puts the loaded model inside the model root via
// `centerOnGround`, i.e. model-root = sourceToModelRoot · reconstruction, where that matrix is the
// loaded object's own local matrix after centering (see src/viewer/captureSpace.ts). The scene's
// `model.rotation/scale/offset` are applied to the model root itself, so they never enter here.
//
// Occlusion is out of scope: a photo can have the target in frame but hidden behind the frame
// tube. The `side` hint (surface normal, or the area's saved view direction) filters out cameras
// that look at the far side of the surface, which removes most of those cases cheaply.

import type { PoseSample } from './capture';
import type { Vec3 } from './schema';

export type Mat4 = number[];

export interface Intrinsics {
  /** Horizontal field of view of the photos, in the sensor's landscape orientation. */
  hFovDeg: number;
  /** Width / height in the sensor's landscape orientation. */
  aspect: number;
}

/** iPhone main camera (26 mm equivalent) in 4:3: about 65° × 51°. Poses carry no intrinsics. */
export const IPHONE_WIDE: Intrinsics = { hFovDeg: 65, aspect: 4 / 3 };

export interface RankTarget {
  point: Vec3;
  /** Direction from the point toward where a good camera sits (surface normal or area view direction). */
  side?: Vec3;
}

export interface RankOptions {
  /** Reconstruction → model-root matrix (column-major). Identity when omitted. */
  toModel?: Mat4;
  intrinsics?: Intrinsics;
  limit?: number;
  /** Skip photos taken from almost the same spot as a better one: same direction from the target within this angle (degrees) and similar distance. */
  minSeparationDeg?: number;
}

export interface RankedPhoto {
  sample: number;
  /** Bundle-relative image path. */
  path: string;
  score: number;
  /** Angle between the camera axis and the target, degrees. */
  angleDeg: number;
  /** Camera-to-target distance in model-root units. */
  distance: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = len(a);
  return l ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
const DEG = 180 / Math.PI;

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** a · b for column-major 4×4 matrices. */
export function mulMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}

export function transformDir(m: Mat4, d: Vec3): Vec3 {
  return [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]];
}

/**
 * What `centerOnGround` does to a model whose bounds (in its own space) are min..max: shift so
 * the box is centered on X/Z and rests on y = 0. Used to check the viewer-side matrix in tests.
 */
export function centeringMatrix(min: Vec3, max: Vec3): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2, 1];
}

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1).toLowerCase();
const stem = (p: string) => base(p).replace(/\.[^.]+$/, '');

/**
 * The image a pose sample was taken from. Object Capture names the file when it can; otherwise
 * fall back to the image whose number matches the sample id (IMG_0007.HEIC for sample 7).
 */
export function imageForSample(sample: PoseSample, images: string[]): string | null {
  if (sample.file) {
    const want = base(sample.file);
    const exact = images.find((p) => base(p) === want);
    if (exact) return exact;
    const byStem = images.find((p) => stem(p) === stem(want));
    if (byStem) return byStem;
  }
  const n = images.filter((p) => Number(stem(p).match(/(\d+)$/)?.[1]) === sample.sample);
  return n.length === 1 ? n[0] : null;
}

/** Ranks photos for a target. Only photos with the target inside their frame are returned. */
export function rankPhotos(samples: PoseSample[], images: string[], target: RankTarget, opts: RankOptions = {}): RankedPhoto[] {
  const toModel = opts.toModel ?? IDENTITY;
  const { hFovDeg, aspect } = opts.intrinsics ?? IPHONE_WIDE;
  const tanH = Math.tan((hFovDeg / 2) / DEG);
  const tanV = tanH / aspect;
  // A little slack: a target right at the edge of the frame is still worth showing, but last.
  const slack = 0.95;
  const halfDiag = Math.atan(Math.hypot(tanH, tanV)) * DEG;
  const side = target.side && len(target.side) > 0 ? unit(target.side) : null;

  const candidates: (RankedPhoto & { dir: Vec3; facing: number })[] = [];
  for (const s of samples) {
    const path = imageForSample(s, images);
    if (!path) continue;
    const m = mulMat4(toModel, s.transform);
    const eye: Vec3 = [m[12], m[13], m[14]];
    const right = unit([m[0], m[1], m[2]]);
    const up = unit([m[4], m[5], m[6]]);
    const forward = unit([-m[8], -m[9], -m[10]]);
    const toTarget = sub(target.point, eye);
    const distance = len(toTarget);
    const depth = dot(toTarget, forward);
    if (distance === 0 || depth <= 0) continue;
    if (Math.abs(dot(toTarget, right) / depth) > tanH * slack || Math.abs(dot(toTarget, up) / depth) > tanV * slack) continue;
    const dirFromTarget = unit(sub(eye, target.point));
    const facing = side ? dot(dirFromTarget, side) : 1;
    // Looking at the back of the surface: the target is almost certainly hidden.
    if (side && facing < -0.1) continue;
    const angleDeg = Math.acos(Math.min(1, depth / distance)) * DEG;
    candidates.push({ sample: s.sample, path, score: 0, angleDeg, distance, dir: dirFromTarget, facing });
  }
  if (!candidates.length) return [];

  // Closeness is relative to the closest usable photo, so scores do not depend on model units.
  const nearest = Math.min(...candidates.map((c) => c.distance));
  for (const c of candidates) {
    const centered = Math.max(0, 1 - c.angleDeg / halfDiag);
    const close = nearest / c.distance;
    c.score = side ? 0.45 * centered + 0.35 * close + 0.2 * ((c.facing + 1) / 2) : 0.55 * centered + 0.45 * close;
  }
  candidates.sort((a, b) => b.score - a.score || a.sample - b.sample);

  const minSep = Math.cos((opts.minSeparationDeg ?? 6) / DEG);
  const picked: typeof candidates = [];
  for (const c of candidates) {
    if (picked.some((p) => dot(p.dir, c.dir) > minSep && Math.abs(Math.log(p.distance / c.distance)) < 0.25)) continue;
    picked.push(c);
    if (picked.length >= (opts.limit ?? 8)) break;
  }
  return picked.map(({ sample, path, score, angleDeg, distance }) => ({ sample, path, score: round(score), angleDeg: round(angleDeg), distance: round(distance) }));
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

/** HEIF/HEIC by its `ftyp` brand (iPhone photos), regardless of the file name. */
export function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const ftyp = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  return ftyp === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand);
}

export function imageMime(path: string): string {
  const ext = path.toLowerCase().split('.').pop();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'heic':
    case 'heif':
      return 'image/heic';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}
