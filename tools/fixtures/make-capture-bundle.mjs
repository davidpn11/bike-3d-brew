#!/usr/bin/env node
// The one generator of synthetic iPhone capture bundles (`bike-capture/1`, see
// docs/ARCHITECTURE.md): one low-poly, vertex-colored bike (ASCII USDZ or GLB), one pose layout
// (three orbit rings, plus close-ups of the key areas), placeholder or rendered photos. Variants:
//
//   node tools/fixtures/make-capture-bundle.mjs [outDir]          # E2E variants (default: apps/web/e2e/.fixtures)
//   node tools/fixtures/make-capture-bundle.mjs --sample out.zip [--name "Synthetic test bike"]
//       # the Pages site sample: GLB, orbit poses, no photos (createdAt from SOURCE_DATE_EPOCH)
//   node tools/fixtures/make-capture-bundle.mjs --photos out.zip [--images <dir of IMG_*.jpg|png>]
//       # USDZ off-origin like a real reconstruction, orbit + close-up poses, one photo per pose
//       # (placeholders, or renders from tools/fixtures/render-photos.mjs)
//
// Output is deterministic (fixed zip mtimes, rounded floats), so it never needs to be committed.
// Importable too: `buildFixtures()` returns { [filename]: Uint8Array }; `buildPhotoBundle()`,
// `buildSampleBundle()` return one zip.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { deflateSync } from 'node:zlib';
import { zipSync } from 'fflate';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const FIXTURE_NAME = 'Fixture Gravel Bike';
export const FIXTURE_CREATED_AT = '2026-01-02T03:04:05Z';
// Local-time components so the DOS timestamps in the zip are identical in every time zone.
const ZIP_MTIME = new Date(2026, 0, 2, 3, 4, 6);
const ROOT = 'BikeCapture-2026-01-02/';
const RINGS = [
  { height: 0.45, radius: 1.7, count: 12 },
  { height: 1.0, radius: 1.8, count: 12 },
  { height: 1.7, radius: 1.3, count: 8 },
];
export const POSE_COUNT = RINGS.reduce((n, r) => n + r.count, 0);
/** The point every orbit camera looks at (bike coordinates). */
export const POSE_TARGET = [0, 0.55, 0];
/** Where the photo bundle's bike sits in its own space, like an Object Capture reconstruction (never centered); centerOnGround undoes it. */
export const MODEL_ORIGIN = [0.21, 0.07, -0.13];
export const PHOTO_NAME = 'Fixture Photo Bike';

const r4 = (n) => Math.round(n * 1e4) / 1e4 + 0; // + 0 turns -0 into 0
const r6 = (n) => Math.round(n * 1e6) / 1e6 + 0;
const enc = (v) => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v, null, 2));

// ------------------------------------------------------------------ bike geometry

const COLORS = {
  frame: [0.78, 0.06, 0.18],
  fork: [0.1, 0.1, 0.12],
  wheel: [0.07, 0.07, 0.07],
  metal: [0.72, 0.74, 0.77],
  saddle: [0.17, 0.14, 0.12],
};

function tubeGeometry(a, b, radius) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const g = new THREE.CylinderGeometry(radius, radius, va.distanceTo(vb), 8, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  g.applyQuaternion(q);
  g.translate(...va.add(vb).multiplyScalar(0.5).toArray());
  return g;
}

function placed(geometry, { position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale));
  return geometry.applyMatrix4(m);
}

function part(name, color, geometries) {
  const merged = mergeGeometries(
    geometries.map((g) => {
      g.deleteAttribute('uv');
      return g.index ? g : g.setIndex([...Array(g.attributes.position.count).keys()]);
    }),
  );
  const pos = merged.attributes.position;
  for (let i = 0; i < pos.array.length; i++) pos.array[i] = r4(pos.array[i]);
  merged.computeVertexNormals();
  // Degenerate vertices (capsule poles) get no normal; give them one so exporters don't complain.
  const nrm = merged.attributes.normal;
  for (let i = 0; i < nrm.count; i++) if (Math.abs(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i)) - 1) > 1e-3) nrm.setXYZ(i, 0, 1, 0);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) colors.set(color, i * 3);
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
  mesh.name = name;
  return mesh;
}

function wheelGeometries(x) {
  const spokes = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    spokes.push(tubeGeometry([x, 0.34, 0], [x + Math.cos(a) * 0.31, 0.34 + Math.sin(a) * 0.31, 0], 0.003));
  }
  return [
    placed(new THREE.TorusGeometry(0.33, 0.018, 8, 40), { position: [x, 0.34, 0] }),
    placed(new THREE.TorusGeometry(0.31, 0.01, 6, 40), { position: [x, 0.34, 0] }),
    placed(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8), { position: [x, 0.34, 0], rotation: [Math.PI / 2, 0, 0] }),
    ...spokes,
  ];
}

/** A ~1.7 m low-poly bike standing on y=0, facing +X, drive side +Z (like the demo bike), shifted by `origin`. */
export function createFixtureBike(origin = [0, 0, 0]) {
  const rear = [-0.5, 0.34, 0];
  const front = [0.5, 0.34, 0];
  const bb = [-0.08, 0.27, 0];
  const seatTop = [-0.22, 0.84, 0];
  const headTop = [0.36, 0.86, 0];
  const headBottom = [0.4, 0.7, 0];
  const stem = [0.46, 0.9, 0];
  const root = new THREE.Group();
  root.name = 'Bike';
  root.add(
    part('frame', COLORS.frame, [
      tubeGeometry(bb, seatTop, 0.018),
      tubeGeometry(seatTop, headTop, 0.017),
      tubeGeometry(bb, headBottom, 0.022),
      tubeGeometry(headBottom, headTop, 0.024),
      tubeGeometry([bb[0], bb[1], 0.04], [rear[0], rear[1], 0.06], 0.01),
      tubeGeometry([bb[0], bb[1], -0.04], [rear[0], rear[1], -0.06], 0.01),
      tubeGeometry([seatTop[0], seatTop[1] - 0.03, 0.02], [rear[0], rear[1], 0.06], 0.009),
      tubeGeometry([seatTop[0], seatTop[1] - 0.03, -0.02], [rear[0], rear[1], -0.06], 0.009),
    ]),
    part('fork', COLORS.fork, [
      tubeGeometry([0.41, 0.67, 0.05], [front[0], front[1], 0.05], 0.012),
      tubeGeometry([0.41, 0.67, -0.05], [front[0], front[1], -0.05], 0.012),
      tubeGeometry([0.41, 0.67, -0.06], [0.41, 0.67, 0.06], 0.02),
    ]),
    part('front-wheel', COLORS.wheel, wheelGeometries(front[0])),
    part('rear-wheel', COLORS.wheel, wheelGeometries(rear[0])),
    part('cockpit', COLORS.fork, [
      tubeGeometry(headTop, stem, 0.015),
      tubeGeometry([stem[0], stem[1], -0.21], [stem[0], stem[1], 0.21], 0.012),
      placed(new THREE.TorusGeometry(0.07, 0.012, 6, 12, Math.PI), { position: [stem[0], stem[1] - 0.07, 0.21], rotation: [0, 0, -Math.PI / 2] }),
      placed(new THREE.TorusGeometry(0.07, 0.012, 6, 12, Math.PI), { position: [stem[0], stem[1] - 0.07, -0.21], rotation: [0, 0, -Math.PI / 2] }),
    ]),
    part('saddle', COLORS.saddle, [
      tubeGeometry(seatTop, [-0.27, 0.98, 0], 0.014),
      placed(new THREE.CapsuleGeometry(0.035, 0.2, 3, 8), { position: [-0.26, 1.0, 0], rotation: [0, 0, Math.PI / 2], scale: [0.45, 1, 1] }),
    ]),
    part('drivetrain', COLORS.metal, [
      placed(new THREE.TorusGeometry(0.1, 0.006, 6, 32), { position: [bb[0], bb[1], 0.07] }),
      placed(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), { position: [rear[0], rear[1], 0.05], rotation: [Math.PI / 2, 0, 0] }),
      tubeGeometry([bb[0], bb[1], 0.09], [bb[0] + 0.12, bb[1] - 0.12, 0.09], 0.009),
      tubeGeometry([bb[0], bb[1] + 0.1, 0.06], [rear[0], rear[1] + 0.05, 0.06], 0.003),
      tubeGeometry([bb[0], bb[1] - 0.1, 0.06], [rear[0], rear[1] - 0.05, 0.06], 0.003),
    ]),
  );
  if (origin.some(Boolean)) for (const mesh of root.children) mesh.geometry.translate(...origin);
  return root;
}

// ------------------------------------------------------------------ USDZ (ASCII USD in a stored zip)

const tuple = (a, i, n) => `(${Array.from({ length: n }, (_, k) => a[i + k]).join(', ')})`;

export function bikeToUsda(root) {
  const meshes = root.children.map((mesh) => {
    const pos = mesh.geometry.attributes.position.array;
    const idx = mesh.geometry.index.array;
    const color = mesh.geometry.attributes.color.array;
    const points = [];
    for (let i = 0; i < pos.length; i += 3) points.push(tuple(pos, i, 3));
    return [
      `    def Mesh "${mesh.name.replace(/-/g, '_')}"`,
      '    {',
      `        int[] faceVertexCounts = [${Array(idx.length / 3).fill(3).join(', ')}]`,
      `        int[] faceVertexIndices = [${Array.from(idx).join(', ')}]`,
      `        point3f[] points = [${points.join(', ')}]`,
      `        color3f[] primvars:displayColor = [(${[...color.slice(0, 3)].map(r4).join(', ')})] (`,
      '            interpolation = "constant"',
      '        )',
      '        uniform bool doubleSided = 0',
      '        uniform token subdivisionScheme = "none"',
      '    }',
    ].join('\n');
  });
  return ['#usda 1.0', '(', '    defaultPrim = "Bike"', '    metersPerUnit = 1', '    upAxis = "Y"', ')', '', 'def Xform "Bike"', '{', meshes.join('\n\n'), '}', ''].join('\n');
}

export function bikeToUsdz(root) {
  // USDZ is an uncompressed zip whose first entry is the root layer.
  return zipSync({ 'model.usda': enc(bikeToUsda(root)) }, { level: 0, mtime: ZIP_MTIME });
}

// ------------------------------------------------------------------ GLB (three's GLTFExporter in Node)

/** GLTFExporter reads its output Blob through FileReader, which Node lacks. */
function ensureFileReader() {
  if (typeof globalThis.FileReader !== 'undefined') return;
  globalThis.FileReader = class {
    result = null;
    onload = null;
    onloadend = null;
    readAsArrayBuffer(blob) {
      void blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      });
    }
    readAsDataURL(blob) {
      void blob.arrayBuffer().then((buf) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      });
    }
  };
}

export async function bikeToGlb(root) {
  ensureFileReader();
  const buf = await new GLTFExporter().parseAsync(root, { binary: true });
  return new Uint8Array(buf);
}

// ------------------------------------------------------------------ poses and photos

const add = (a, b) => a.map((v, i) => v + b[i]);

/** Column-major camera→model matrix for a camera at `eye` looking at `target`. */
export function lookAtTransform(eye, target, up = [0, 1, 0]) {
  const e = new THREE.Vector3(...eye);
  // Matrix4.lookAt builds a basis whose +Z points from target to eye: a camera looking down -Z.
  return new THREE.Matrix4().lookAt(e, new THREE.Vector3(...target), new THREE.Vector3(...up)).setPosition(e).toArray().map(r6);
}

/** Cameras on three rings around a bike at `origin`, each looking at it. */
export function orbitPoses(origin = [0, 0, 0]) {
  const samples = [];
  for (const ring of RINGS) {
    for (let i = 0; i < ring.count; i++) {
      const a = (i / ring.count) * Math.PI * 2;
      const eye = add(origin, [Math.cos(a) * ring.radius, ring.height, Math.sin(a) * ring.radius]);
      const n = samples.length;
      samples.push({ sample: n, file: imageName(n), transform: lookAtTransform(eye, add(origin, POSE_TARGET)) });
    }
  }
  return { schema: 'bike-poses/1', samples };
}

/** Close-ups a careful shooter adds after the orbits (bike coordinates). */
const CLOSEUPS = [
  { target: [0.41, 0.68, 0], eye: [0.92, 0.77, 0.35] }, // fork crown / head tube
  { target: [0.5, 0.34, 0], eye: [0.85, 0.45, 0.45] }, // front hub
  { target: [-0.08, 0.27, 0.07], eye: [0.02, 0.42, 0.6] }, // chainring
  { target: [-0.5, 0.34, 0.07], eye: [-0.7, 0.5, 0.55] }, // rear hub, drive side
  { target: [0.46, 0.9, 0], eye: [0.2, 1.4, 0.3] }, // cockpit from above
  { target: [-0.26, 1.0, 0], eye: [-0.58, 1.38, 0.4] }, // saddle
  { target: [-0.22, 0.8, 0], eye: [-0.35, 0.9, -0.55] }, // seat cluster, non-drive side
  { target: [0.38, 0.78, 0], eye: [0.56, 0.89, -0.6] }, // head tube, non-drive side
];
export const CLOSEUP_COUNT = CLOSEUPS.length;

/** Orbit poses followed by close-ups, numbered like Object Capture samples (bike at `origin`). */
export function capturePoses(origin = MODEL_ORIGIN) {
  const poses = orbitPoses(origin);
  for (const { target, eye } of CLOSEUPS) {
    const n = poses.samples.length;
    poses.samples.push({ sample: n, file: imageName(n), transform: lookAtTransform(add(origin, eye), add(origin, target)) });
  }
  return poses;
}

const imageName = (n) => `IMG_${String(n).padStart(4, '0')}.png`;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A tiny solid-color PNG standing in for an Object Capture HEIC photo. */
export function placeholderPng(rgb, size = 8) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.from([0, ...Array.from({ length: size }, () => rgb).flat()]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  return new Uint8Array(png);
}

/** Placeholder photo `i` of `n`: a gray that gets lighter around the orbit. */
function placeholderPhoto(i, n) {
  const shade = 90 + Math.round((150 * i) / n);
  return placeholderPng([shade, shade, Math.min(255, shade + 20)]);
}

// ------------------------------------------------------------------ bundles

function manifest(overrides = {}) {
  return {
    schema: 'bike-capture/1',
    name: FIXTURE_NAME,
    createdAt: FIXTURE_CREATED_AT,
    device: 'iPhone16,1 (fixture)',
    systemVersion: '18.1',
    mode: 'object',
    model: 'model.usdz',
    poses: 'poses.json',
    images: 'images/',
    imageCount: POSE_COUNT,
    ...overrides,
  };
}

/** Zips `files` (path → bytes or JSON value) under `prefix`, deterministically. */
export function zipBundle(files, prefix = ROOT) {
  const zippable = {};
  for (const [path, value] of Object.entries(files)) {
    if (value === undefined) continue;
    zippable[prefix + path] = value instanceof Uint8Array ? value : enc(value);
  }
  return zipSync(zippable, { mtime: ZIP_MTIME });
}

/**
 * All fixtures by filename. Bundles share the same manifest name/createdAt (so they map to the
 * same scene id) except where a variant needs otherwise.
 */
export async function buildFixtures() {
  const bike = createFixtureBike();
  const usdz = bikeToUsdz(bike);
  const glb = await bikeToGlb(bike);
  const poses = orbitPoses();
  const images = {};
  poses.samples.forEach((s, i) => (images[`images/${s.file}`] = placeholderPhoto(i, POSE_COUNT)));
  const ios = { 'manifest.json': manifest(), 'model.usdz': usdz, 'poses.json': poses, ...images, 'record.json': { schema: 'bike-record/1', fixture: true } };
  const brokenPoses = { schema: 'bike-poses/1', samples: [{ sample: 0, transform: [1, 0, 0] }] };
  return {
    'bike.bikecapture.zip': zipBundle(ios),
    'bike-glb.bikecapture.zip': zipBundle({ ...ios, 'model.usdz': undefined, 'model.glb': glb, 'manifest.json': manifest({ name: 'Fixture GLB Bike', model: 'model.glb' }) }),
    'bike-flat.bikecapture.zip': zipBundle({ ...ios, 'manifest.json': manifest({ name: 'Fixture Flat Bike' }), '__MACOSX/._model.usdz': new Uint8Array(16) }, ''),
    'bike-no-model.bikecapture.zip': zipBundle({ ...ios, 'model.usdz': undefined, 'manifest.json': manifest({ name: 'Fixture Unfinished Bike', model: null }) }),
    'bike-broken-poses.bikecapture.zip': zipBundle({ ...ios, 'manifest.json': manifest({ name: 'Fixture Broken Poses' }), 'poses.json': brokenPoses }),
    'not-a-zip.bikecapture.zip': enc('this is not a zip file\n'),
    'bike.usdz': usdz,
    'bike.glb': glb,
  };
}

/**
 * The bundle the photo close-up tests open: the bike off-origin, orbit + close-up poses and one
 * photo per pose. `images` ({ ext, data } in pose order) replaces the placeholders.
 */
export function buildPhotoBundle({ name = PHOTO_NAME, images = null } = {}) {
  const poses = capturePoses();
  const n = poses.samples.length;
  if (images && images.length !== n) throw new Error(`The photo bundle needs ${n} photos (one per pose), got ${images.length}`);
  const files = {};
  poses.samples.forEach((s, i) => {
    if (images) s.file = s.file.replace(/png$/, images[i].ext);
    files[`images/${s.file}`] = images ? images[i].data : placeholderPhoto(i, n);
  });
  const model = bikeToUsdz(createFixtureBike(MODEL_ORIGIN));
  return zipBundle({ 'manifest.json': manifest({ name, imageCount: n }), 'model.usdz': model, 'poses.json': poses, ...files, 'record.json': { schema: 'bike-record/1', fixture: true } });
}

/** The sample on the Pages site (tools/publish-pages.sh): the bike as GLB, orbit poses, no photos. */
export async function buildSampleBundle({ name = 'Synthetic test bike', createdAt = FIXTURE_CREATED_AT } = {}) {
  const meta = { name, createdAt, device: 'Synthetic (tools/fixtures/make-capture-bundle.mjs)', model: 'model.glb', imageCount: 0 };
  return zipBundle({ 'manifest.json': manifest(meta), 'model.glb': await bikeToGlb(createFixtureBike()), 'poses.json': orbitPoses() }, 'synthetic-export/');
}

export async function writeFixtures(outDir) {
  const fixtures = await buildFixtures();
  mkdirSync(outDir, { recursive: true });
  for (const [name, bytes] of Object.entries(fixtures)) writeFileSync(join(outDir, name), bytes);
  return Object.keys(fixtures).map((name) => join(outDir, name));
}

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT_DIR = resolve(here, '../../apps/web/e2e/.fixtures');

function writeZip(out, zip) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, zip);
  console.log(`wrote ${out} (${(zip.length / 1024).toFixed(0)} KB)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: opt, positionals } = parseArgs({ allowPositionals: true, options: { sample: { type: 'string' }, photos: { type: 'string' }, name: { type: 'string' }, images: { type: 'string' } } });
  if (opt.sample) {
    // SOURCE_DATE_EPOCH (seconds, set by tools/publish-pages.sh) stamps the sample with the commit time.
    const epoch = process.env.SOURCE_DATE_EPOCH;
    const createdAt = epoch ? new Date(Number(epoch) * 1000).toISOString().replace(/\.\d+Z$/, 'Z') : undefined;
    writeZip(resolve(opt.sample), await buildSampleBundle({ name: opt.name, createdAt }));
  } else if (opt.photos) {
    const dir = opt.images;
    const images = dir
      ? readdirSync(dir)
          .filter((f) => /\.(jpe?g|png|heic)$/i.test(f))
          .sort()
          .map((f) => ({ ext: f.split('.').pop().toLowerCase(), data: readFileSync(join(dir, f)) }))
      : null;
    writeZip(resolve(opt.photos), buildPhotoBundle({ name: opt.name, images }));
  } else {
    for (const file of await writeFixtures(resolve(positionals[0] ?? DEFAULT_OUT_DIR))) console.log(file);
  }
}
