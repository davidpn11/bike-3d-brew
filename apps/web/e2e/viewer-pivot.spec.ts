import { expect, test } from './test';
import { openApp, waitForCamera, waitForModel } from './helpers';

test('pivotAt moves the orbit target to the surface hit and ignores misses', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await waitForModel(page);
  await waitForCamera(page);

  const point = await page.evaluate(() => {
    const { viewer } = window.__bike!;
    const canvas = viewer.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    // Search around the demo frame's seat/head tube junction, then retain the actual picked surface point.
    const center = viewer.project([0.2, 0.78, 0]) ?? { x: rect.width / 2, y: rect.height / 2 };
    for (let radius = 0; radius < 120; radius += 4) {
      for (let dx = -radius; dx <= radius; dx += 4) {
        for (const dy of [-radius, radius]) {
          const x = rect.left + center.x + dx;
          const y = rect.top + center.y + dy;
          const hit = viewer.pick(x, y);
          if (hit) return { x, y, hit: hit.position };
        }
      }
      for (let dy = -radius + 4; dy < radius; dy += 4) {
        for (const dx of [-radius, radius]) {
          const x = rect.left + center.x + dx;
          const y = rect.top + center.y + dy;
          const hit = viewer.pick(x, y);
          if (hit) return { x, y, hit: hit.position };
        }
      }
    }
    return null;
  });
  expect(point).not.toBeNull();

  const pivoted = await page.evaluate(({ x, y }) => {
    const { viewer, pivotAt } = window.__bike!;
    const before = viewer.getView();
    const ok = pivotAt(x, y);
    return { ok, before, after: viewer.getView() };
  }, point!);
  expect(pivoted.ok).toBe(true);
  expect(pivoted.after.target).toEqual(point!.hit);
  expect(pivoted.after.position).toEqual(pivoted.before.position);

  const miss = await page.evaluate(() => {
    const { viewer, pivotAt } = window.__bike!;
    const before = viewer.getView();
    const rect = viewer.renderer.domElement.getBoundingClientRect();
    const ok = pivotAt(rect.left + 2, rect.top + 2);
    return { ok, before, after: viewer.getView() };
  });
  expect(miss.ok).toBe(false);
  expect(miss.after).toEqual(miss.before);
  await waitForCamera(page);
});
