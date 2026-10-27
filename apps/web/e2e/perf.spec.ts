import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { writeCompressedGlbs } from '../../../tools/fixtures/make-compressed-glb.mjs';
import { FIXTURE_DIR, collectErrors, dropFile, fixture, openApp, toast } from './helpers';

// Rendering/loading performance behavior (docs/PERFORMANCE.md): render on demand, lazy decoders.

const COMPRESSED = join(FIXTURE_DIR, 'compressed');

test.beforeAll(async () => {
  await writeCompressedGlbs(fixture('bike.glb'), COMPRESSED);
});

/** Renders the viewer draws during `ms` of wall time (measured in the page). */
async function rendersDuring(page: import('@playwright/test').Page, ms: number): Promise<number> {
  return page.evaluate(async (ms) => {
    const { viewer } = window.__bike!;
    const start = viewer.renderCount;
    await new Promise((r) => setTimeout(r, ms));
    return viewer.renderCount - start;
  }, ms);
}

const settled = (page: import('@playwright/test').Page) => page.waitForFunction(() => window.__bike?.viewer.rendering === false);

test('an idle stage draws nothing; orbiting draws and stops again', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);
  await settled(page);
  expect(await rendersDuring(page, 1000)).toBe(0);

  const pin = page.locator('.pin-layer .pin:not(.offscreen)').first();
  const before = await pin.evaluate((el) => el.style.transform);
  const touch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  const start = await page.evaluate(() => window.__bike!.viewer.renderCount);
  // A short horizontal drag that starts on bare canvas (not on a pin or a toolbar).
  const { x, y } = await page.evaluate(() => {
    const canvas = window.__bike!.viewer.renderer.domElement;
    const r = canvas.getBoundingClientRect();
    for (let ring = 0; ring < 80; ring++) {
      for (let i = 0; i < Math.max(1, ring * 8); i++) {
        const a = (i / Math.max(1, ring * 8)) * Math.PI * 2;
        const x = Math.round(r.left + r.width / 2 + Math.cos(a) * ring * 4);
        const y = Math.round(r.top + r.height / 2 + Math.sin(a) * ring * 4);
        if (x > r.left + 8 && x < r.right - 120 && document.elementFromPoint(x, y) === canvas) return { x, y };
      }
    }
    return null!;
  });
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    const touchAt = (type: 'touchStart' | 'touchMove' | 'touchEnd', dx: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: x + dx, y }] });
    await touchAt('touchStart', 0);
    for (let i = 1; i <= 8; i++) await touchAt('touchMove', i * 12);
    await touchAt('touchEnd', 96);
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x + i * 12, y);
    await page.mouse.up();
  }
  await expect.poll(() => page.evaluate(() => window.__bike!.viewer.renderCount)).toBeGreaterThan(start);
  await settled(page);
  expect(await pin.evaluate((el) => el.style.transform)).not.toBe(before);
  expect(await rendersDuring(page, 500)).toBe(0);
  expect(errors).toEqual([]);
});

test('a canvas snapshot still has the bike on it (no preserved drawing buffer needed)', async ({ page }) => {
  await openApp(page);
  await settled(page);
  const opaque = await page.evaluate(async () => {
    const url = window.__bike!.viewer.screenshot();
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n / (data.length / 4);
  });
  expect(opaque).toBeGreaterThan(0.02);
});

for (const [file, extension] of [
  ['bike-meshopt.glb', 'EXT_meshopt_compression'],
  ['bike-draco.glb', 'KHR_draco_mesh_compression'],
  ['bike-ktx2.glb', 'KHR_texture_basisu'],
] as const) {
  test(`opens a ${extension} GLB with a lazily loaded, self-hosted decoder`, async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const foreign: string[] = [];
    page.on('request', (r) => {
      const url = r.url();
      if (!url.startsWith(baseURL!) && !/^(data|blob):/.test(url)) foreign.push(url);
    });
    await openApp(page);
    const demoTriangles = await page.evaluate(() => window.__bike!.viewer.modelTriangles);
    await dropFile(page, join(COMPRESSED, file));
    await expect(page.locator('#topbar .brand strong')).toHaveText(file.replace('.glb', ''));
    await page.waitForFunction((n) => window.__bike!.viewer.modelTriangles !== n, demoTriangles);
    await expect(toast(page)).toBeHidden();
    const model = await page.evaluate(() => {
      const { viewer } = window.__bike!;
      let ktx2 = 0;
      viewer.modelRoot.traverse((o) => {
        const map = ((o as import('three').Mesh).material as import('three').MeshStandardMaterial | undefined)?.map;
        if (map?.userData.mimeType === 'image/ktx2') ktx2++;
      });
      return { triangles: viewer.modelTriangles, part: !!viewer.modelRoot.getObjectByName('front-wheel'), ktx2 };
    });
    expect(model.triangles).toBeGreaterThan(4000);
    expect(model.part).toBe(true);
    if (extension === 'KHR_texture_basisu') expect(model.ktx2).toBeGreaterThan(0);
    expect(foreign).toEqual([]);
    expect(errors).toEqual([]);
  });
}
