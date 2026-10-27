#!/usr/bin/env node
// Writes a synthetic `*.bikecapture.zip` (bike-capture/1) for testing the viewer's bundle import
// without an iPhone: a low-poly bike as model.glb, a manifest, an orbit of camera poses and no
// photos. Generated geometry only, never a real capture.
//
//   node tools/make-test-bundle.mjs [out.bikecapture.zip] [--name "Synthetic test bike"]
import fs from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';

const args = process.argv.slice(2);
const nameAt = args.indexOf('--name');
const name = nameAt >= 0 ? args.splice(nameAt, 2)[1] : 'Synthetic test bike';
const out = path.resolve(args[0] ?? 'synthetic-bike.bikecapture.zip');

// ---- geometry (meters, +Y up, ground at y=0, front wheel towards +X) ----
const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const mul = (a, s) => a.map((v) => v * s);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.hypot(...a));

/** Flat-shaded triangles: positions and per-face normals, non-indexed. */
function mesh() {
  const pos = [];
  const nrm = [];
  const tri = (a, b, c) => {
    const n = norm(cross(sub(b, a), sub(c, a)));
    pos.push(...a, ...b, ...c);
    nrm.push(...n, ...n, ...n);
  };
  /** An n-sided prism from a to b, radius r (caps omitted: tubes are thin and double-sided). */
  const tube = (a, b, r, sides = 8) => {
    const d = norm(sub(b, a));
    const u = norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const v = cross(d, u);
    const ring = (c) => Array.from({ length: sides }, (_, i) => {
      const t = (i / sides) * Math.PI * 2;
      return add(c, add(mul(u, Math.cos(t) * r), mul(v, Math.sin(t) * r)));
    });
    const ra = ring(a);
    const rb = ring(b);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      tri(ra[i], ra[j], rb[j]);
      tri(ra[i], rb[j], rb[i]);
    }
  };
  return { pos, nrm, tube };
}

const wheels = mesh();
for (const x of [-0.5, 0.5]) {
  const hub = [x, 0.34, 0];
  const rim = Array.from({ length: 32 }, (_, i) => {
    const t = (i / 32) * Math.PI * 2;
    return [x + Math.cos(t) * 0.33, 0.34 + Math.sin(t) * 0.33, 0];
  });
  rim.forEach((p, i) => wheels.tube(p, rim[(i + 1) % rim.length], 0.018, 6));
  for (let i = 0; i < rim.length; i += 2) wheels.tube(hub, rim[i], 0.002, 3);
  wheels.tube([x, 0.34, -0.05], [x, 0.34, 0.05], 0.02);
}

const frame = mesh();
const bb = [0, 0.28, 0];
const seatTop = [-0.15, 0.82, 0];
const headTop = [0.4, 0.82, 0];
const headBottom = [0.44, 0.66, 0];
frame.tube(bb, seatTop, 0.018);
frame.tube(seatTop, headTop, 0.016);
frame.tube(bb, headBottom, 0.022);
frame.tube(headBottom, headTop, 0.022);
for (const z of [-0.05, 0.05]) {
  frame.tube(bb, [-0.5, 0.34, z], 0.011);
  frame.tube([-0.13, 0.78, 0], [-0.5, 0.34, z], 0.009);
  frame.tube(headBottom, [0.5, 0.34, z], 0.012); // fork legs
}
frame.tube(headTop, [0.46, 0.92, 0], 0.014); // stem
frame.tube([0.46, 0.92, -0.22], [0.46, 0.92, 0.22], 0.012); // bar
frame.tube(seatTop, [-0.18, 0.92, 0], 0.012); // seatpost
frame.tube([-0.3, 0.93, 0], [-0.05, 0.93, 0], 0.035, 6); // saddle
frame.tube([0, 0.28, -0.07], [0, 0.28, 0.07], 0.06, 12); // chainring

// ---- GLB ----
function glb(prims) {
  const chunks = [];
  const accessors = [];
  const bufferViews = [];
  let offset = 0;
  const pushFloats = (arr, withBounds) => {
    const f = new Float32Array(arr);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: f.byteLength, target: 34962 });
    const acc = { bufferView: bufferViews.length - 1, componentType: 5126, count: arr.length / 3, type: 'VEC3' };
    if (withBounds) {
      acc.min = [0, 1, 2].map((k) => Math.min(...arr.filter((_, i) => i % 3 === k)));
      acc.max = [0, 1, 2].map((k) => Math.max(...arr.filter((_, i) => i % 3 === k)));
    }
    accessors.push(acc);
    chunks.push(new Uint8Array(f.buffer));
    offset += f.byteLength;
    return accessors.length - 1;
  };
  const primitives = prims.map((p, material) => ({ attributes: { POSITION: pushFloats(p.mesh.pos, true), NORMAL: pushFloats(p.mesh.nrm, false) }, material }));
  const json = {
    asset: { version: '2.0', generator: 'bike-3d-brew tools/make-test-bundle.mjs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'bike' }],
    meshes: [{ name: 'bike', primitives }],
    materials: prims.map((p) => ({ name: p.name, doubleSided: true, pbrMetallicRoughness: { baseColorFactor: p.color, metallicFactor: p.metal, roughnessFactor: 0.45 } })),
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };
  const pad4 = (n) => (n + 3) & ~3;
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(jsonBytes.length);
  const binLen = pad4(offset);
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const outBuf = new Uint8Array(total);
  const dv = new DataView(outBuf.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  outBuf.fill(0x20, 20, 20 + jsonLen);
  outBuf.set(jsonBytes, 20);
  let at = 20 + jsonLen;
  dv.setUint32(at, binLen, true);
  dv.setUint32(at + 4, 0x004e4942, true); // "BIN\0"
  at += 8;
  for (const c of chunks) {
    outBuf.set(c, at);
    at += c.length;
  }
  return outBuf;
}

const model = glb([
  { name: 'tyres', mesh: wheels, color: [0.08, 0.08, 0.09, 1], metal: 0.1 },
  { name: 'frame', mesh: frame, color: [0.78, 0.12, 0.1, 1], metal: 0.6 },
]);

// ---- poses: one orbit at hub height, cameras looking at the bike (camera→model, column-major) ----
const samples = Array.from({ length: 24 }, (_, i) => {
  const t = (i / 24) * Math.PI * 2;
  const eye = [Math.cos(t) * 1.8, 0.5, Math.sin(t) * 1.8];
  const z = norm(sub(eye, [0, 0.5, 0])); // camera looks down -Z
  const x = norm(cross([0, 1, 0], z));
  const y = cross(z, x);
  return { sample: i, file: `IMG_${String(i).padStart(4, '0')}.HEIC`, transform: [...x, 0, ...y, 0, ...z, 0, ...eye, 1] };
});

// SOURCE_DATE_EPOCH (seconds) makes the output reproducible, e.g. for tools/publish-pages.sh.
const when = process.env.SOURCE_DATE_EPOCH ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000) : new Date();
const createdAt = when.toISOString().replace(/\.\d+Z$/, 'Z');
const manifest = {
  schema: 'bike-capture/1',
  name,
  createdAt,
  device: 'Synthetic (tools/make-test-bundle.mjs)',
  systemVersion: 'n/a',
  mode: 'object',
  model: 'model.glb',
  poses: 'poses.json',
  images: 'images/',
  imageCount: 0,
};
const enc = (v) => new TextEncoder().encode(JSON.stringify(v, null, 2));
// Nested in a folder, like the iOS export (NSFileCoordinator zips the staging directory).
const dir = 'synthetic-export/';
const zip = zipSync(
  {
    [dir + 'manifest.json']: enc(manifest),
    [dir + 'model.glb']: model,
    [dir + 'poses.json']: enc({ schema: 'bike-poses/1', samples }),
  },
  { mtime: when },
);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, zip);
console.log(`Wrote ${out} (${(zip.length / 1024).toFixed(0)} KB, model ${(model.length / 1024).toFixed(0)} KB)`);
