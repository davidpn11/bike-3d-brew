#!/usr/bin/env node
// Rendering/loading benchmark for the web viewer (docs/PERFORMANCE.md).
//
//   npm run build && node tools/bench/bench.mjs [--model big.usdz] [--pins 50] [--out result.json] [--skip-build]
//
// Drives the production build in Chromium (SwiftShader WebGL, like the E2E suite) through the
// `?e2e` test hook: boots the demo, idles, orbits with the mouse, adds N pins and orbits again,
// then optionally opens a big model (e.g. `tools/fixtures/make-usdc.py object-capture big.usdz
// --detail 90 --tex 2048`) and repeats. Prints one JSON report.
//
// SwiftShader renders on the CPU, so absolute fps are far below a phone GPU: compare runs on the
// same machine and look at render counts and per-frame costs, not at raw fps.

import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const PORT = Number(opt('port', 4290));
const MODEL = opt('model', '');
const PINS = Number(opt('pins', 50));
const OUT = opt('out', '');
const VIEWPORT = (opt('viewport', '1280x800') || '1280x800').split('x').map(Number);

if (!args.includes('--skip-build')) {
  const b = spawnSync('npx', ['vite', 'build', '--config', 'apps/web/vite.config.ts'], { cwd: root, stdio: 'inherit' });
  if (b.status) process.exit(b.status);
}
const server = spawn('npx', ['vite', 'preview', '--config', 'apps/web/vite.config.ts', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
const base = `http://localhost:${PORT}/`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 100) throw new Error('vite preview did not start');
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'],
});
const report = { date: new Date().toISOString(), viewport: VIEWPORT.join('x'), pins: PINS };
try {
  const page = await browser.newPage({ viewport: { width: VIEWPORT[0], height: VIEWPORT[1] } });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  const logs = [];
  page.on('console', (m) => /USDZ|BVH/.test(m.text()) && logs.push(m.text()));
  const t0 = Date.now();
  await page.goto(`${base}?e2e`);
  await page.waitForFunction(() => window.__bike?.ready === true);
  report.bootMs = Date.now() - t0;
  await instrument(page);

  report.demo = {
    frameCost: await frameCost(page),
    idle: await idle(page, 3000),
    orbit: await orbit(page),
  };
  await addPins(page, PINS);
  report.demo.idleWithPins = await idle(page, 3000);
  report.demo.orbitWithPins = await orbit(page);

  if (MODEL) {
    await settle(page);
    const start = await page.evaluate(() => performance.now());
    await page.setInputFiles('input[type=file]', resolve(MODEL));
    // "Visible" = the first frame drawn with the new model (not when the loader resolved).
    await page.waitForFunction(() => window.__bench.firstModelRender > 0, null, { timeout: 180_000, polling: 100 });
    const visibleMs = Math.round((await page.evaluate(() => window.__bench.firstModelRender)) - start);
    // Then whatever runs after the first frame (BVH build) and the next frames.
    await settle(page);
    const big = { visibleMs, settledMs: Math.round((await page.evaluate(() => performance.now())) - start), geometry: await geometry(page), log: logs };
    big.frameCost = await frameCost(page);
    await addPins(page, PINS);
    big.idle = await idle(page, 2000);
    big.orbit = await orbit(page, 20);
    big.raycast = await raycasts(page);
    report.model = { file: MODEL, ...big };
  }
} finally {
  await browser.close();
  server.kill();
}
const json = JSON.stringify(report, null, 2);
console.log(json);
if (OUT) writeFileSync(OUT, json);

/** Counts renders and times them (wraps renderer.render) plus the frame listeners (pins). */
async function instrument(page) {
  await page.evaluate(() => {
    const { viewer } = window.__bike;
    viewer.modelRoot.children[0].userData.bench = 'demo';
    const bench = (window.__bench = { renders: 0, renderMs: 0, listenerMs: 0, firstModelRender: 0 });
    // Frame listeners (pin projection + occlusion, draft pin) run after every render.
    const listeners = viewer.frameListeners;
    for (const fn of [...listeners]) {
      listeners.delete(fn);
      listeners.add(() => {
        const t = performance.now();
        fn();
        bench.listenerMs += performance.now() - t;
      });
    }
    const render = viewer.renderer.render.bind(viewer.renderer);
    viewer.renderer.render = (s, c) => {
      const t = performance.now();
      render(s, c);
      bench.renders++;
      bench.renderMs += performance.now() - t;
      if (!bench.firstModelRender && viewer.modelRoot.children[0] && viewer.modelRoot.children[0].userData.bench !== 'demo') bench.firstModelRender = performance.now();
    };
  });
}

async function snapshot(page) {
  return page.evaluate(() => ({ ...window.__bench, now: performance.now(), heap: performance.memory?.usedJSHeapSize ?? 0 }));
}

function delta(a, b) {
  const seconds = (b.now - a.now) / 1000;
  const renders = b.renders - a.renders;
  return {
    seconds: +seconds.toFixed(2),
    renders,
    rendersPerSecond: +(renders / seconds).toFixed(2),
    msPerRender: renders ? +((b.renderMs - a.renderMs) / renders).toFixed(1) : 0,
    mainThreadBusyPct: +(((b.renderMs - a.renderMs + b.listenerMs - a.listenerMs) / (b.now - a.now)) * 100).toFixed(1),
  };
}

/** Waits until the viewer stops rendering (render-on-demand builds) or ~1 s passed (render-every-frame builds). */
async function settle(page) {
  const onDemand = await page.evaluate(() => 'rendering' in window.__bike.viewer);
  if (onDemand) await page.waitForFunction(() => !window.__bike.viewer.rendering, null, { timeout: 180_000, polling: 100 });
  else await page.waitForTimeout(1000);
}

/**
 * Cost of one complete frame as drawn while orbiting: render + a 1-pixel readback that waits for
 * the GPU (SwiftShader: the CPU) to finish. Average of 3 after a warm-up frame.
 */
async function frameCost(page) {
  await settle(page);
  return page.evaluate(() => {
    const { viewer } = window.__bike;
    const r = viewer.renderer;
    const gl = r.getContext();
    const px = new Uint8Array(4);
    const frame = () => {
      viewer.camera.updateMatrixWorld();
      r.render(viewer.scene, viewer.camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    };
    frame();
    const t = performance.now();
    for (let i = 0; i < 3; i++) frame();
    return { ms: +((performance.now() - t) / 3).toFixed(1), pixelRatio: r.getPixelRatio(), shadowAutoUpdate: r.shadowMap.autoUpdate };
  });
}

async function idle(page, ms) {
  await settle(page);
  const a = await snapshot(page);
  await page.waitForTimeout(ms);
  return delta(a, await snapshot(page));
}

/** Drags across the canvas like a user orbiting, then waits for damping to settle. */
async function orbit(page, steps = 40) {
  const box = await page.locator('#viewport canvas').boundingBox();
  // Start the drag on bare canvas, not on a pin (pins swallow the pointer).
  const { x: cx, y: cy } = await page.evaluate(() => {
    const canvas = window.__bike.viewer.renderer.domElement;
    const r = canvas.getBoundingClientRect();
    for (let ring = 0; ring < 60; ring++) {
      for (let i = 0; i < Math.max(1, ring * 8); i++) {
        const a = (i / Math.max(1, ring * 8)) * Math.PI * 2;
        const x = r.left + r.width / 2 + Math.cos(a) * ring * 5;
        const y = r.top + r.height / 2 + Math.sin(a) * ring * 5;
        if (document.elementFromPoint(x, y) === canvas) return { x, y };
      }
    }
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const a = await snapshot(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(cx + Math.sin((i / steps) * Math.PI) * box.width * 0.3, cy + (i / steps) * 20);
  await page.mouse.up();
  const b = await snapshot(page);
  const d = delta(a, b);
  return { ...d, moves: steps, rendersPerMove: +(d.renders / steps).toFixed(2), pinUpdateMsPerRender: b.renders > a.renders ? +((b.listenerMs - a.listenerMs) / (b.renders - a.renders)).toFixed(2) : 0 };
}

/** Pins N comments on pickable points spread over the canvas (bench only; tests use the UI). */
async function addPins(page, n) {
  await page.evaluate((n) => {
    const { viewer, store } = window.__bike;
    viewer.setView(viewer.overviewView());
    const r = viewer.renderer.domElement.getBoundingClientRect();
    const annotations = store.scene.annotations.filter((a) => !a.id.startsWith('bench-'));
    for (let y = 0.2; y < 0.9 && annotations.length < n; y += 0.02) {
      for (let x = 0.1; x < 0.9 && annotations.length < n; x += 0.035) {
        const hit = viewer.pick(r.left + x * r.width, r.top + y * r.height);
        if (hit) annotations.push({ id: `bench-${annotations.length}`, title: `Pin ${annotations.length}`, body: '', kind: 'note', position: hit.position, normal: hit.normal });
      }
    }
    store.replace({ ...store.scene, annotations });
  }, n);
}

async function geometry(page) {
  return page.evaluate(() => {
    const { viewer } = window.__bike;
    let vertices = 0;
    let triangles = 0;
    let bytes = 0;
    let indexed = 0;
    let meshes = 0;
    viewer.modelRoot.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      const g = o.geometry;
      vertices += g.attributes.position.count;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
      if (g.index) {
        indexed++;
        bytes += g.index.array.byteLength;
      }
      for (const a of Object.values(g.attributes)) bytes += a.array.byteLength;
    });
    const info = viewer.renderer.info;
    return { meshes, indexed, vertices, triangles: Math.round(triangles), geometryMB: +(bytes / 1048576).toFixed(1), heapMB: +((performance.memory?.usedJSHeapSize ?? 0) / 1048576).toFixed(1), gpu: { ...info.memory } };
  });
}

/** Average cost of one pick() and one isOccluded() (the occlusion test pins run). */
async function raycasts(page) {
  return page.evaluate(() => {
    const { viewer, store } = window.__bike;
    const r = viewer.renderer.domElement.getBoundingClientRect();
    let t = performance.now();
    let hits = 0;
    for (let i = 0; i < 10; i++) if (viewer.pick(r.left + r.width * (0.3 + i * 0.04), r.top + r.height * 0.5)) hits++;
    const pickMs = (performance.now() - t) / 10;
    const pts = store.scene.annotations.slice(0, 10);
    t = performance.now();
    for (const a of pts) viewer.isOccluded(a.position);
    const occludedMs = pts.length ? (performance.now() - t) / pts.length : 0;
    return { pickMs: +pickMs.toFixed(2), pickHits: hits, isOccludedMs: +occludedMs.toFixed(2) };
  });
}
