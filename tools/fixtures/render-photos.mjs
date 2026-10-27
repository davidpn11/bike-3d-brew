#!/usr/bin/env node
// Renders the fixture bike from every fixture camera pose, so the synthetic capture bundle has
// "photos" that really show what each pose sees (useful to eyeball the close-up ranking):
//
//   node tools/fixtures/render-photos.mjs [outDir] && node tools/fixtures/make-capture.mjs out.zip --images outDir
//
// Also importable: `renderPhotos(poses, { executablePath })` returns JPEG bytes per pose (the E2E
// global setup uses it to build `bike-photos.bikecapture.zip`).
//
// Uses headless Chromium through Playwright (not a project dependency: it resolves a local or
// global install) with three.js from node_modules. Intrinsics match the ranking's assumption
// (src/scene/photos.ts IPHONE_WIDE: 65° horizontal, 4:3, landscape).

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBike, capturePoses } from './make-capture.mjs';

const require = createRequire(import.meta.url);
function playwright() {
  try {
    return require('playwright');
  } catch {
    return require(join(execSync('npm root -g').toString().trim(), 'playwright'));
  }
}

const here = fileURLToPath(new URL('.', import.meta.url));
const threeDir = resolve(here, '../../node_modules/three/build');
const W = 640;
const H = 480;
const H_FOV = 65;

const page = `<!doctype html><html><body style="margin:0">
<script type="importmap">{"imports":{"three":"./three.module.js"}}</script>
<script type="module">
import * as THREE from 'three';
window.render = (meshes, poses, w, h, hFov) => {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(w, h);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd9dbe0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  let minY = Infinity;
  for (const m of meshes) {
    const pos = [];
    for (const f of m.faces) for (let i = 1; i + 1 < f.length; i++) pos.push(...m.points[f[0]], ...m.points[f[i]], ...m.points[f[i + 1]]);
    for (const p of m.points) minY = Math.min(minY, p[1]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...m.color, THREE.SRGBColorSpace), roughness: 0.55, side: THREE.DoubleSide })));
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0xa7abb3, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = minY;
  scene.add(floor);
  const vFov = 2 * Math.atan(Math.tan((hFov * Math.PI) / 360) / (w / h)) * 180 / Math.PI;
  const camera = new THREE.PerspectiveCamera(vFov, w / h, 0.01, 50);
  camera.matrixAutoUpdate = false;
  const label = document.createElement('canvas');
  label.width = w;
  label.height = h;
  const ctx = label.getContext('2d');
  return poses.map((p) => {
    // Pose = camera→model, camera looking down -Z: exactly a three.js camera's world matrix.
    camera.matrix.fromArray(p.transform);
    camera.matrixWorld.copy(camera.matrix);
    camera.matrixWorldInverse.copy(camera.matrix).invert();
    renderer.render(scene, camera);
    ctx.drawImage(renderer.domElement, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(10, h - 40, 150, 30);
    ctx.fillStyle = '#fff';
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillText(p.file, 20, h - 18);
    return label.toDataURL('image/jpeg', 0.85);
  });
};
window.ready = true;
</script></body></html>`;

/**
 * Renders the fixture bike once per pose. Returns `{ file, data }` JPEGs in pose order.
 * `executablePath` lets callers use a preinstalled Chromium (PW_CHROMIUM_PATH).
 */
export async function renderPhotos(poses, { executablePath } = {}) {
  const { chromium } = playwright();
  const browser = await chromium.launch({ executablePath: executablePath || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const tab = await browser.newPage();
    await tab.route('https://fixture.local/**', (route) => {
      const name = new URL(route.request().url()).pathname.slice(1);
      if (name === 'index.html') return route.fulfill({ contentType: 'text/html', body: page });
      return route.fulfill({ contentType: 'text/javascript', body: readFileSync(join(threeDir, name)) });
    });
    await tab.goto('https://fixture.local/index.html');
    await tab.waitForFunction(() => window.ready);
    const shots = await tab.evaluate(([meshes, poses, w, h, fov]) => window.render(meshes, poses, w, h, fov), [buildBike(), poses, W, H, H_FOV]);
    return shots.map((url, i) => ({ file: poses[i].file, data: new Uint8Array(Buffer.from(url.split(',')[1], 'base64')) }));
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = resolve(process.argv[2] ?? 'tools/fixtures/out/photos');
  const photos = await renderPhotos(capturePoses(24), { executablePath: process.env.PW_CHROMIUM_PATH });
  mkdirSync(outDir, { recursive: true });
  for (const { file, data } of photos) writeFileSync(join(outDir, `${file}.jpg`), data);
  console.log(`wrote ${photos.length} photos to ${outDir}`);
}
