// COLMAP sparse model (TXT, from `colmap model_converter --output_type TXT`) → `bike-poses/1`.
//
// COLMAP stores world→camera poses with OpenCV camera axes (+X right, +Y down, +Z forward) and
// a Hamilton quaternion QW QX QY QZ. The viewer wants camera→model with the camera looking down
// -Z and +Y up (three.js), so: T_c2w = [Rᵀ | -Rᵀt], then flip the camera's Y and Z axes.
// The model frame is COLMAP's world frame, which OpenMVS keeps for the mesh it builds from it.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Camera models whose first parameter is a single focal length; the rest start with fx, fy.
const SINGLE_FOCAL = new Set(['SIMPLE_PINHOLE', 'SIMPLE_RADIAL', 'RADIAL', 'SIMPLE_RADIAL_FISHEYE', 'RADIAL_FISHEYE']);
// COLMAP 3.12 src/colmap/sensor/models.h, enum order / parameter count.
const CAMERA_MODELS = [
  ['SIMPLE_PINHOLE', 3], ['PINHOLE', 4], ['SIMPLE_RADIAL', 4], ['RADIAL', 5], ['OPENCV', 8], ['OPENCV_FISHEYE', 8],
  ['FULL_OPENCV', 12], ['FOV', 5], ['SIMPLE_RADIAL_FISHEYE', 4], ['RADIAL_FISHEYE', 5], ['THIN_PRISM_FISHEYE', 12],
];

class BinaryReader {
  constructor(data, file) { this.data = data; this.file = file; this.offset = 0; }
  need(size) {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.data.length - this.offset) {
      throw new Error(`${this.file}: truncated or oversized binary model at byte ${this.offset}`);
    }
  }
  u8() { this.need(1); return this.data[this.offset++]; }
  i32() { this.need(4); const v = this.data.readInt32LE(this.offset); this.offset += 4; return v; }
  u32() { this.need(4); const v = this.data.readUInt32LE(this.offset); this.offset += 4; return v; }
  u64() { this.need(8); const v = this.data.readBigUInt64LE(this.offset); this.offset += 8; if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${this.file}: oversized count/value at byte ${this.offset - 8}`); return Number(v); }
  i64() { this.need(8); const v = this.data.readBigInt64LE(this.offset); this.offset += 8; if (v < BigInt(Number.MIN_SAFE_INTEGER) || v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${this.file}: oversized value at byte ${this.offset - 8}`); return Number(v); }
  f64() { this.need(8); const v = this.data.readDoubleLE(this.offset); this.offset += 8; if (!Number.isFinite(v)) throw new Error(`${this.file}: non-finite value at byte ${this.offset - 8}`); return v; }
  count(minBytes) { const n = this.u64(); if (n > Math.floor((this.data.length - this.offset) / minBytes)) throw new Error(`${this.file}: oversized count ${n} at byte ${this.offset - 8}`); return n; }
  name() { const start = this.offset; while (this.offset < this.data.length && this.data[this.offset] !== 0) this.offset++; if (this.offset === this.data.length) throw new Error(`${this.file}: unterminated image name at byte ${start}`); const name = this.data.toString('utf8', start, this.offset); this.offset++; return name; }
  done() { if (this.offset !== this.data.length) throw new Error(`${this.file}: unexpected trailing bytes at byte ${this.offset}`); }
}

function intrinsics(modelId, width, height, params, file) {
  const model = CAMERA_MODELS[modelId];
  if (!model || params.length !== model[1]) throw new Error(`${file}: unsupported camera model id ${modelId}`);
  const [name] = model;
  const [fx, fy, cx, cy] = SINGLE_FOCAL.has(name) ? [params[0], params[0], params[1], params[2]] : params;
  return { model: name, width, height, params, fx, fy, cx, cy };
}

export function parseCamerasBin(data) {
  const r = new BinaryReader(data, 'cameras.bin'), out = new Map(), count = r.count(24);
  for (let i = 0; i < count; i++) {
    const id = r.u32(), modelId = r.i32(), width = r.u64(), height = r.u64(), model = CAMERA_MODELS[modelId];
    if (!model) throw new Error(`cameras.bin: unsupported camera model id ${modelId}`);
    const params = Array.from({ length: model[1] }, () => r.f64());
    out.set(id, { ...intrinsics(modelId, width, height, params, 'cameras.bin'), id });
  }
  r.done(); return out;
}

export function parseImagesBin(data) {
  const r = new BinaryReader(data, 'images.bin'), out = [], count = r.count(64);
  for (let i = 0; i < count; i++) {
    const id = r.u32(), q = Array.from({ length: 4 }, () => r.f64()), t = Array.from({ length: 3 }, () => r.f64()), cameraId = r.u32(), name = r.name();
    const len = Math.hypot(...q); if (!len) throw new Error('images.bin: zero quaternion');
    const observations = r.count(24);
    r.need(observations * 24);
    r.offset += observations * 24;
    out.push({ id, q: q.map((v) => v === 0 ? 0 : v / len), t, cameraId, name });
  }
  r.done(); return out;
}

export function parsePoints3DBin(data) {
  const r = new BinaryReader(data, 'points3D.bin'), out = [], count = r.count(51);
  for (let i = 0; i < count; i++) {
    const id = r.u64(), xyz = Array.from({ length: 3 }, () => r.f64()), rgb = [r.u8(), r.u8(), r.u8()], error = r.f64(), track = r.count(8);
    r.need(track * 8); r.offset += track * 8;
    out.push({ id, xyz, rgb, error });
  }
  r.done(); return out;
}

/** Non-comment lines with their 1-based line numbers. Blank lines are kept: images.txt pairs lines. */
function lines(text) {
  return text
    .split(/\r?\n/)
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => !line.startsWith('#'));
}

function nums(tokens, file, n) {
  const out = tokens.map(Number);
  if (out.some((v) => !Number.isFinite(v))) throw new Error(`${file}:${n}: expected numbers, got "${tokens.join(' ')}"`);
  return out;
}

/** cameras.txt: `CAMERA_ID MODEL WIDTH HEIGHT PARAMS[]` → Map id → camera with pinhole intrinsics. */
export function parseCameras(text) {
  const cameras = new Map();
  for (const { line, n } of lines(text)) {
    if (!line) continue;
    const [id, model, ...rest] = line.split(/\s+/);
    const [width, height, ...params] = nums(rest, 'cameras.txt', n);
    if (!model || params.length < 3) throw new Error(`cameras.txt:${n}: expected CAMERA_ID MODEL WIDTH HEIGHT PARAMS[]`);
    const single = SINGLE_FOCAL.has(model);
    const [fx, fy, cx, cy] = single ? [params[0], params[0], params[1], params[2]] : params;
    if (![fx, fy, cx, cy].every(Number.isFinite)) throw new Error(`cameras.txt:${n}: too few parameters for ${model}`);
    cameras.set(Number(id), { id: Number(id), model, width, height, params, fx, fy, cx, cy });
  }
  return cameras;
}

/** images.txt: two lines per image, `IMAGE_ID QW QX QY QZ TX TY TZ CAMERA_ID NAME` then its 2D points (may be empty). */
export function parseImages(text) {
  const images = [];
  const all = lines(text);
  for (let i = 0; i < all.length; i++) {
    const { line, n } = all[i];
    if (!line) continue;
    const tokens = line.split(/\s+/);
    if (tokens.length < 10) throw new Error(`images.txt:${n}: expected IMAGE_ID QW QX QY QZ TX TY TZ CAMERA_ID NAME`);
    const [id, qw, qx, qy, qz, tx, ty, tz, cameraId] = nums(tokens.slice(0, 9), 'images.txt', n);
    const len = Math.hypot(qw, qx, qy, qz);
    if (!len) throw new Error(`images.txt:${n}: zero quaternion`);
    images.push({ id, q: [qw / len, qx / len, qy / len, qz / len], t: [tx, ty, tz], cameraId, name: tokens.slice(9).join(' ') });
    i++; // the POINTS2D line belongs to this image, even when it is blank
  }
  return images;
}

/** points3D.txt: `POINT3D_ID X Y Z R G B ERROR TRACK[]` → sparse points (track dropped). */
export function parsePoints3D(text) {
  const points = [];
  for (const { line, n } of lines(text)) {
    if (!line) continue;
    const tokens = line.split(/\s+/);
    if (tokens.length < 8) throw new Error(`points3D.txt:${n}: expected POINT3D_ID X Y Z R G B ERROR TRACK[]`);
    const [id, x, y, z, r, g, b, error] = nums(tokens.slice(0, 8), 'points3D.txt', n);
    points.push({ id, xyz: [x, y, z], rgb: [r, g, b], error });
  }
  return points;
}

/** Row-major 3×3 rotation of a unit Hamilton quaternion (w, x, y, z). */
export function quatToMat3([w, x, y, z]) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

/**
 * Column-major camera→model transform for a COLMAP world→camera pose. The camera→world
 * rotation is Rᵀ, so its columns are R's rows; Y and Z are negated for the -Z / +Y-up camera.
 */
export function colmapToTransform(q, t) {
  const R = quatToMat3(q);
  const c = [0, 1, 2].map((k) => -(R[0][k] * t[0] + R[1][k] * t[1] + R[2][k] * t[2]));
  return [...R[0], 0, ...R[1].map((v) => -v), 0, ...R[2].map((v) => -v), 0, ...c, 1];
}

/**
 * `bike-poses/1` from parsed COLMAP cameras + images. Samples are ordered by image name (capture
 * order for numbered frames); `file` is the basename, which is what `package` puts in images/.
 * `camera` carries the real intrinsics (pixels); the viewer ignores it today.
 */
export function colmapToPoses(cameras, images, imageFile = 'images.txt') {
  const sorted = [...images].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  return {
    schema: 'bike-poses/1',
    samples: sorted.map((img, sample) => {
      const cam = cameras.get(img.cameraId);
      if (!cam) throw new Error(`${imageFile}: image ${img.name} uses unknown camera ${img.cameraId}`);
      const { width, height, fx, fy, cx, cy } = cam;
      return {
        sample,
        file: img.name.slice(img.name.lastIndexOf('/') + 1),
        transform: colmapToTransform(img.q, img.t),
        camera: { model: cam.model, width, height, fx, fy, cx, cy },
      };
    }),
  };
}

/** Reads a COLMAP model folder; sparse points are optional and loaded only on request. */
export function readColmapDir(dir, { includePoints = false } = {}) {
  const binary = !existsSync(join(dir, 'cameras.txt'));
  if (binary && !existsSync(join(dir, 'cameras.bin'))) throw new Error(`COLMAP model directory has neither cameras.txt nor cameras.bin: ${dir}`);
  if (binary && !existsSync(join(dir, 'images.bin'))) throw new Error(`COLMAP binary model is missing images.bin: ${dir}`);
  if (binary) {
    const read = (f) => readFileSync(join(dir, f));
    const cameras = parseCamerasBin(read('cameras.bin'));
    const images = parseImagesBin(read('images.bin'));
    const { points, pointsWarning } = includePoints ? readPoints(() => read('points3D.bin'), parsePoints3DBin) : { points: [], pointsWarning: undefined };
    return { cameras, images, points, pointsWarning, poses: colmapToPoses(cameras, images, 'images.bin') };
  }
  const read = (f) => readFileSync(join(dir, f), 'utf8');
  const cameras = parseCameras(read('cameras.txt'));
  const images = parseImages(read('images.txt'));
  const { points, pointsWarning } = includePoints ? readPoints(() => read('points3D.txt'), parsePoints3D) : { points: [], pointsWarning: undefined };
  return { cameras, images, points, pointsWarning, poses: colmapToPoses(cameras, images) };
}

function readPoints(read, parse) {
  try { return { points: parse(read()), pointsWarning: undefined }; }
  catch (err) { return { points: [], pointsWarning: `could not read optional sparse points: ${err.message}` }; }
}
