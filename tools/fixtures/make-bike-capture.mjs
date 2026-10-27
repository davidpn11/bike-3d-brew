#!/usr/bin/env node
// Builds a synthetic iPhone capture bundle (`*.bikecapture.zip`, bike-capture/1) for manual and
// E2E testing: the procedural demo bike as an ASCII USD mesh inside model.usdz, posed at an
// arbitrary rotation/offset like a scan that came out lying on its side. Generated, never real.
//
//   node tools/fixtures/make-bike-capture.mjs --out /tmp/tilted.bikecapture.zip --rotate 70,25,-40
//   node tools/fixtures/make-bike-capture.mjs --out /tmp/area.bikecapture.zip --rotate 0,0,0 --offset 0,0,0 --ground --mode area
//
// Importable too: `buildBikeCapture({ name, rotate, offset, mode, ground })` returns the zip bytes
// (the E2E global setup writes `tilted-bike` and `area-bike` bundles with it).
//
// Needs Node ≥ 22.18 (imports the TypeScript demo bike with built-in type stripping).

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { strToU8, zipSync } from 'fflate';
import * as THREE from 'three';
import { createDemoBike } from '../../apps/web/src/viewer/demoBike.ts';

/** Euler angles in degrees, offset in meters. */
export function buildBikeCapture({ name = 'Synthetic tilted bike', rotate = [70, 25, -40], offset = [0.4, 1.2, -0.3], mode = 'object', ground = false } = {}) {
  const args = { name, mode, ground };
  const bike = createDemoBike();
  const parts = [bike];
  if (args.ground) {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.04, 1.6, 26, 1, 16), new THREE.MeshStandardMaterial({ color: 0x8a7f72 }));
    floor.position.set(0, -0.02, 0);
    // Background clutter a room scan picks up: a wall strip and a box away from the bike.
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 0.04), new THREE.MeshStandardMaterial({ color: 0xb9c2c9 }));
    wall.position.set(0, 0.6, -0.8);
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0x9b6b3d }));
    crate.position.set(1.1, 0.15, 0.55);
    parts.push(floor, wall, crate);
  }
  const pose = new THREE.Group();
  pose.add(...parts);
  pose.rotation.set(...rotate.map((d) => (d * Math.PI) / 180), 'XYZ');
  pose.position.set(...offset);
  pose.updateMatrixWorld(true);

  // One USD mesh per material colour keeps the file small and the bike readable.
  const byColor = new Map();
  pose.traverse((o) => {
    if (!o.isMesh) return;
    const color = o.material.color.getHexString();
    const g = o.geometry.index ? o.geometry : o.geometry.clone().setIndex([...Array(o.geometry.attributes.position.count).keys()]);
    const entry = byColor.get(color) ?? { color: o.material.color, points: [], indices: [] };
    const base = entry.points.length / 3;
    const v = new THREE.Vector3();
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      entry.points.push(+v.x.toFixed(5), +v.y.toFixed(5), +v.z.toFixed(5));
    }
    for (let i = 0; i < g.index.count; i++) entry.indices.push(base + g.index.getX(i));
    byColor.set(color, entry);
  });

  const meshes = [...byColor.values()].map((m, i) => {
    const pts = [];
    for (let k = 0; k < m.points.length; k += 3) pts.push(`(${m.points[k]}, ${m.points[k + 1]}, ${m.points[k + 2]})`);
    const { r, g, b } = m.color.clone().convertLinearToSRGB();
    return `    def Mesh "part_${i}"
      {
          int[] faceVertexCounts = [${new Array(m.indices.length / 3).fill(3).join(', ')}]
          int[] faceVertexIndices = [${m.indices.join(', ')}]
          point3f[] points = [${pts.join(', ')}]
          color3f[] primvars:displayColor = [(${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)})]
          uniform token subdivisionScheme = "none"
      }`;
  });
  const usda = `#usda 1.0
  (
      defaultPrim = "Bike"
      metersPerUnit = 1
      upAxis = "Y"
  )

  def Xform "Bike"
  {
  ${meshes.join('\n')}
  }
  `;
  // USDZ is a stored (uncompressed) zip whose first entry is the root layer.
  const usdz = zipSync({ 'model.usda': [strToU8(usda), { level: 0 }] });

  const manifest = {
    schema: 'bike-capture/1',
    name: args.name,
    createdAt: '2026-10-27T12:00:00Z',
    device: 'Synthetic fixture',
    systemVersion: '0',
    mode: args.mode === 'area' ? 'area' : 'object',
    model: 'model.usdz',
    poses: 'poses.json',
    images: 'images/',
    imageCount: 0,
  };
  const zip = zipSync({
    'export/manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'export/model.usdz': [usdz, { level: 0 }],
    'export/poses.json': strToU8(JSON.stringify({ schema: 'bike-poses/1', samples: [] })),
  });
  return zip;
}

const nums = (s) => s.split(',').map(Number);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values: args } = parseArgs({
    options: {
      out: { type: 'string', default: 'tilted.bikecapture.zip' },
      name: { type: 'string', default: 'Synthetic tilted bike' },
      rotate: { type: 'string', default: '70,25,-40' }, // Euler XYZ degrees
      offset: { type: 'string', default: '0.4,1.2,-0.3' }, // meters
      mode: { type: 'string', default: 'object' },
      ground: { type: 'boolean', default: false }, // add a floor slab + clutter, like an area-mode scan
    },
  });
  const zip = buildBikeCapture({ name: args.name, rotate: nums(args.rotate), offset: nums(args.offset), mode: args.mode, ground: args.ground });
  writeFileSync(args.out, zip);
  console.log(`${args.out}: ${(zip.length / 1024).toFixed(0)} KB, rotate ${args.rotate}°, offset ${args.offset} m${args.ground ? ', with ground' : ''}`);
}
