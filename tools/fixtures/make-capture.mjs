#!/usr/bin/env node
// Generates a synthetic `bike-capture/1` bundle (what the iOS app exports) for tests and manual
// QA, so no real customer capture ever needs to live in the repo:
//
//   node tools/fixtures/make-capture.mjs [out.bikecapture.zip] [--images <dir of IMG_*.jpg|png>]
//
// - model.usdz: an ASCII USD layer with a simple low-poly bike (wheels, frame, fork, saddle, bar),
//   deliberately NOT centered on the origin, like a real Object Capture reconstruction.
// - poses.json: cameras orbiting the bike at two heights plus close-ups of the key areas,
//   camera→model, looking down -Z, +Y up.
// - images/: one photo per pose. Placeholder PNGs unless --images supplies rendered ones
//   (see tools/fixtures/render-photos.mjs).
// - Everything nested in one folder, like NSFileCoordinator's .forUploading zip.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

/** Where the reconstruction sits in its own space; the viewer's centerOnGround undoes this. */
export const MODEL_ORIGIN = [0.21, 0.07, -0.13];

// ------------------------------------------------------------------ geometry

function torus(cx, cy, cz, R, r, segU = 40, segV = 8) {
  const points = [];
  const faces = [];
  for (let i = 0; i < segU; i++) {
    const u = (i / segU) * Math.PI * 2;
    for (let j = 0; j < segV; j++) {
      const v = (j / segV) * Math.PI * 2;
      const d = R + r * Math.cos(v);
      points.push([cx + d * Math.cos(u), cy + d * Math.sin(u), cz + r * Math.sin(v)]);
    }
  }
  for (let i = 0; i < segU; i++) {
    for (let j = 0; j < segV; j++) {
      const a = i * segV + j;
      const b = ((i + 1) % segU) * segV + j;
      const c = ((i + 1) % segU) * segV + ((j + 1) % segV);
      const d = i * segV + ((j + 1) % segV);
      faces.push([a, b, c, d]);
    }
  }
  return { points, faces };
}

/** A capped tube from a to b. */
function tube(a, b, r, seg = 10) {
  const axis = sub(b, a);
  const n = norm(axis);
  const helper = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(n, helper));
  const v = cross(n, u);
  const points = [];
  for (const end of [a, b]) {
    for (let i = 0; i < seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      points.push(add(end, add(scale(u, Math.cos(t) * r), scale(v, Math.sin(t) * r))));
    }
  }
  const faces = [];
  for (let i = 0; i < seg; i++) faces.push([i, (i + 1) % seg, seg + ((i + 1) % seg), seg + i]);
  faces.push([...Array(seg).keys()].reverse());
  faces.push([...Array(seg).keys()].map((i) => seg + i));
  return { points, faces };
}

function box(min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const points = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]];
  return { points, faces };
}

function merge(parts) {
  const points = [];
  const faces = [];
  for (const p of parts) {
    const base = points.length;
    points.push(...p.points);
    faces.push(...p.faces.map((f) => f.map((i) => i + base)));
  }
  return { points, faces };
}

/** Low-poly road bike in meters, +Y up, facing +X, offset by MODEL_ORIGIN. */
export function buildBike() {
  const rear = [-0.5, 0.34, 0];
  const front = [0.5, 0.34, 0];
  const bb = [-0.05, 0.3, 0];
  const seatTop = [-0.17, 0.78, 0];
  const headTop = [0.4, 0.82, 0];
  const headBottom = [0.44, 0.66, 0];
  const parts = [
    { name: 'rear_wheel', color: [0.08, 0.08, 0.09], ...merge([torus(...rear, 0.33, 0.018), tube(add(rear, [0, 0, -0.04]), add(rear, [0, 0, 0.04]), 0.03)]) },
    { name: 'front_wheel', color: [0.08, 0.08, 0.09], ...merge([torus(...front, 0.33, 0.018), tube(add(front, [0, 0, -0.04]), add(front, [0, 0, 0.04]), 0.03)]) },
    {
      name: 'frame',
      color: [0.85, 0.2, 0.12],
      ...merge([
        tube(bb, seatTop, 0.018),
        tube(seatTop, headTop, 0.017),
        tube(bb, headBottom, 0.022),
        tube(headBottom, headTop, 0.024),
        tube(bb, add(rear, [0, 0, 0.05]), 0.011),
        tube(bb, add(rear, [0, 0, -0.05]), 0.011),
        tube(add(seatTop, [0, -0.04, 0]), add(rear, [0, 0, 0.05]), 0.009),
        tube(add(seatTop, [0, -0.04, 0]), add(rear, [0, 0, -0.05]), 0.009),
      ]),
    },
    { name: 'fork', color: [0.15, 0.15, 0.17], ...merge([tube(headBottom, add(front, [0, 0, 0.05]), 0.012), tube(headBottom, add(front, [0, 0, -0.05]), 0.012)]) },
    { name: 'drivetrain', color: [0.7, 0.7, 0.72], ...merge([torus(bb[0], bb[1], 0.07, 0.1, 0.012, 32, 6), tube(add(bb, [0, 0, 0.07]), add(rear, [0, 0, 0.07]), 0.006)]) },
    { name: 'saddle', color: [0.1, 0.1, 0.1], ...merge([box([-0.3, 0.8, -0.07], [-0.05, 0.84, 0.07]), tube(seatTop, [-0.18, 0.81, 0], 0.013)]) },
    { name: 'cockpit', color: [0.2, 0.2, 0.22], ...merge([tube(headTop, [0.48, 0.86, 0], 0.014), tube([0.48, 0.86, -0.21], [0.48, 0.86, 0.21], 0.012)]) },
  ];
  return parts.map((p) => ({ ...p, points: p.points.map((q) => add(q, MODEL_ORIGIN)) }));
}

/** Bounds center of the bike in reconstruction space: the cameras' look-at point. */
export function bikeCenter() {
  return add([0, 0.47, 0], MODEL_ORIGIN);
}

export function toUsda(meshes) {
  const f = (n) => Number(n.toFixed(5));
  const body = meshes
    .map(
      (m) => `    def Mesh "${m.name}"
    {
        int[] faceVertexCounts = [${m.faces.map((x) => x.length).join(', ')}]
        int[] faceVertexIndices = [${m.faces.flat().join(', ')}]
        point3f[] points = [${m.points.map((p) => `(${p.map(f).join(', ')})`).join(', ')}]
        color3f[] primvars:displayColor = [(${m.color.join(', ')})]
        uniform token subdivisionScheme = "none"
    }`,
    )
    .join('\n\n');
  return `#usda 1.0
(
    defaultPrim = "Bike"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "Bike"
{
${body}
}
`;
}

/** A USDZ is a zip whose first entry is the USD layer, stored uncompressed. */
export function makeUsdz(meshes = buildBike()) {
  return zipSync({ 'model.usda': [new TextEncoder().encode(toUsda(meshes)), { level: 0 }] });
}

// ------------------------------------------------------------------ poses

/** Column-major camera→model matrix for a camera at `eye` looking at `target` (camera looks down -Z). */
export function lookAtTransform(eye, target, up = [0, 1, 0]) {
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return [...x, 0, ...y, 0, ...z, 0, ...eye, 1].map((n) => Number(n.toFixed(6)));
}

/** Two orbits like a real capture pass: hub height and above saddle. */
export function orbitPoses(count = 24) {
  const center = bikeCenter();
  const perRing = Math.ceil(count / 2);
  const samples = [];
  for (let i = 0; i < count; i++) {
    const ring = i < perRing ? 0 : 1;
    const k = ring ? i - perRing : i;
    const angle = (k / perRing) * Math.PI * 2 + ring * 0.25;
    const radius = ring ? 1.3 : 1.55;
    const eye = add(center, [Math.cos(angle) * radius, ring ? 0.75 : -0.05, Math.sin(angle) * radius]);
    samples.push({ sample: i, file: `IMG_${String(i).padStart(4, '0')}`, transform: lookAtTransform(eye, center) });
  }
  return samples;
}

/** Close-ups a careful shooter adds after the orbits (bike coordinates, before MODEL_ORIGIN). */
const CLOSEUPS = [
  { target: [0.44, 0.66, 0], eye: [0.95, 0.75, 0.35] }, // fork crown / head tube
  { target: [0.5, 0.34, 0], eye: [0.85, 0.45, 0.45] }, // front hub
  { target: [-0.05, 0.3, 0.07], eye: [0.05, 0.45, 0.6] }, // chainring
  { target: [-0.5, 0.34, 0.07], eye: [-0.7, 0.5, 0.55] }, // rear hub, drive side
  { target: [0.46, 0.84, 0], eye: [0.2, 1.35, 0.3] }, // cockpit from above
  { target: [-0.18, 0.82, 0], eye: [-0.5, 1.2, 0.4] }, // saddle
  { target: [-0.17, 0.74, 0], eye: [-0.3, 0.85, -0.55] }, // seat cluster, non-drive side
  { target: [0.42, 0.74, 0], eye: [0.6, 0.85, -0.6] }, // head tube, non-drive side
];

/** Orbit poses followed by close-ups, numbered like Object Capture samples. */
export function capturePoses(orbit = 24, closeups = true) {
  const samples = orbitPoses(orbit);
  if (closeups) {
    CLOSEUPS.forEach(({ target, eye }, k) => {
      const i = orbit + k;
      samples.push({ sample: i, file: `IMG_${String(i).padStart(4, '0')}`, transform: lookAtTransform(add(eye, MODEL_ORIGIN), add(target, MODEL_ORIGIN)) });
    });
  }
  return samples;
}

// ------------------------------------------------------------------ images

/** Minimal PNG encoder (RGB, no filtering) so placeholders need no image library. */
export function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function placeholder(i, n) {
  const hue = (i / n) * 360;
  const [r, g, b] = hsl(hue, 0.55, 0.45);
  return png(160, 120, (x, y) => ((x >> 4) + (y >> 4)) % 2 ? [r, g, b] : [r * 0.8, g * 0.8, b * 0.8].map(Math.round));
}

function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))));
}

// ------------------------------------------------------------------ bundle

export function makeBundle({ name = 'Fixture Road Bike', count = 24, closeups = true, images = null, folder = 'Fixture Road Bike 2026-10-27' } = {}) {
  const samples = capturePoses(count, closeups);
  count = samples.length;
  const files = {};
  samples.forEach((s, i) => {
    const supplied = images?.[i];
    const ext = supplied ? supplied.ext : 'png';
    s.file = `${s.file}.${ext}`;
    files[`images/${s.file}`] = supplied ? supplied.data : placeholder(i, count);
  });
  const manifest = {
    schema: 'bike-capture/1',
    name,
    createdAt: '2026-10-27T09:30:00Z',
    device: 'Fixture generator',
    systemVersion: '0',
    mode: 'object',
    model: 'model.usdz',
    poses: 'poses.json',
    images: 'images/',
    imageCount: count,
  };
  const enc = (v) => new TextEncoder().encode(JSON.stringify(v, null, 2));
  const zippable = {};
  for (const [path, data] of Object.entries({ 'manifest.json': enc(manifest), 'model.usdz': makeUsdz(), 'poses.json': enc({ schema: 'bike-poses/1', samples }), ...files, 'record.json': enc({}) })) {
    zippable[`${folder}/${path}`] = data;
  }
  return zipSync(zippable);
}

// ------------------------------------------------------------------ math

function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(...a); return scale(a, 1 / l); }

// ------------------------------------------------------------------ CLI

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const imgFlag = args.indexOf('--images');
  let images = null;
  if (imgFlag >= 0) {
    const dir = args.splice(imgFlag, 2)[1];
    images = readdirSync(dir)
      .filter((f) => /\.(jpe?g|png|heic)$/i.test(f))
      .sort()
      .map((f) => ({ ext: f.split('.').pop().toLowerCase(), data: readFileSync(join(dir, f)) }));
  }
  const out = resolve(args[0] ?? 'tools/fixtures/out/fixture.bikecapture.zip');
  mkdirSync(dirname(out), { recursive: true });
  const zip = makeBundle({ images, count: images ? Math.max(0, images.length - CLOSEUPS.length) : 24 });
  writeFileSync(out, zip);
  console.log(`wrote ${out} (${(zip.length / 1024).toFixed(0)} KB)`);
}
