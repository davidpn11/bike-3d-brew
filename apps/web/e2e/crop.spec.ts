import { type Page, expect, test } from '@playwright/test';
import type { Vec3 } from '../src/scene/schema';
import { collectErrors, fixture, openApp, openViaPicker, scene, snap, tapCanvas, toast, waitForCamera, waitForModel } from './helpers';

/** Client position of a model-root point, or null when it is off the canvas or under some UI. */
const screenOf = (page: Page, p: Vec3) =>
  page.evaluate((p) => {
    const { viewer } = window.__bike!;
    const s = viewer.project(p);
    const r = viewer.renderer.domElement.getBoundingClientRect();
    if (!s) return null;
    const x = Math.round(r.left + s.x);
    const y = Math.round(r.top + s.y);
    return document.elementFromPoint(x, y) === viewer.renderer.domElement ? { x, y } : null;
  }, p);

/** A pickable point on the bike at least 50 px from every crop handle (a tap there must pin, not drag). */
const bikePointAwayFromHandles = (page: Page) =>
  page.evaluate(() => {
    const { viewer, store } = window.__bike!;
    const canvas = viewer.renderer.domElement;
    const r = canvas.getBoundingClientRect();
    const box = store.scene.crop!;
    const handles: { x: number; y: number }[] = [];
    for (let axis = 0; axis < 3; axis++) {
      for (const side of ['min', 'max'] as const) {
        const p = box.min.map((v, i) => (v + box.max[i]) / 2) as [number, number, number];
        p[axis] = box[side][axis];
        const s = viewer.project(p);
        if (s) handles.push({ x: r.left + s.x, y: r.top + s.y });
      }
    }
    for (let y = r.top + 8; y < r.bottom - 8; y += 6) {
      for (let x = r.left + 8; x < r.right - 8; x += 6) {
        if (handles.some((h) => Math.hypot(h.x - x, h.y - y) < 50)) continue;
        if (document.elementFromPoint(x, y) !== canvas) continue;
        if (viewer.pick(x, y)) return { x, y };
      }
    }
    return null;
  });

/** Client position of a crop handle (axis 1 = up, side max = top face). */
const handleOf = (page: Page, axis: number, side: 'min' | 'max') =>
  page.evaluate(
    ({ axis, side }) => {
      const { viewer, store } = window.__bike!;
      const box = store.scene.crop!;
      const p = box.min.map((v, i) => (v + box.max[i]) / 2) as [number, number, number];
      p[axis] = box[side][axis];
      const s = viewer.project(p)!;
      const r = viewer.renderer.domElement.getBoundingClientRect();
      return { x: r.left + s.x, y: r.top + s.y };
    },
    { axis, side },
  );

test.describe('crop box', () => {
  test('area-mode capture: Fit to bike removes the floor, and cropped parts take no comments', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await openApp(page);
    await openViaPicker(page, fixture('area-bike.bikecapture.zip'));
    await expect(toast(page)).toContainText('Area-mode capture: turn on Crop in Edit → Model');
    await waitForModel(page);
    let s = await scene(page);
    // A box is suggested but off, and the room is not auto-oriented before cropping.
    expect(s.crop?.enabled).toBe(false);
    expect(s.model.rotation).toBeUndefined();

    // A floor point in front of the bike, near the scan's front-right corner.
    const bounds = await page.evaluate(() => {
      const b = window.__bike!.viewer.boundsOf()!;
      return { min: b.min.toArray(), max: b.max.toArray() };
    });
    const floor: Vec3 = [bounds.max[0] - 0.08, bounds.min[1] + 0.04, bounds.max[2] - 0.08];
    let px = await screenOf(page, floor);
    expect(px, 'floor corner visible').not.toBeNull();
    expect(await page.evaluate(({ x, y }) => window.__bike!.viewer.pick(x, y), px!)).not.toBeNull();
    await snap(page, testInfo, 'area-loaded');

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('.model-tools input[name=crop]').check();
    await waitForCamera(page);
    s = await scene(page);
    expect(s.crop?.enabled).toBe(true);
    expect(s.crop!.min[1]).toBeGreaterThan(bounds.min[1] + 0.03); // the 4 cm floor slab is below the box
    expect(s.crop!.max[0] - s.crop!.min[0]).toBeLessThan(1.9); // bike length, not the 2.6 m room
    await expect(page.locator('.model-tools input[name=length]')).toHaveValue(/^1[67]\d$/);

    // Where the floor was there is nothing to pick, and tapping there opens no comment editor.
    px = await screenOf(page, floor);
    if (px) {
      expect(await page.evaluate(({ x, y }) => window.__bike!.viewer.pick(x, y), px)).toBeNull();
      await tapCanvas(page, px);
      await expect(page.locator('form.editor')).toHaveCount(0);
    }
    // The bike itself still takes comments.
    const onBike = await bikePointAwayFromHandles(page);
    expect(onBike, 'a bike point away from the handles').not.toBeNull();
    await tapCanvas(page, onBike!);
    await expect(page.locator('form.editor')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await snap(page, testInfo, 'cropped');

    // Drag the top face down: one store update, the saddle and bars are cut.
    const before = (await scene(page)).crop!;
    const top = await handleOf(page, 1, 'max');
    await page.mouse.move(top.x, top.y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(top.x, top.y + i * 12);
    await page.mouse.up();
    const dragged = (await scene(page)).crop!;
    expect(dragged.max[1]).toBeLessThan(before.max[1] - 0.05);
    expect(dragged.min).toEqual(before.min);
    await snap(page, testInfo, 'dragged-top');

    await page.locator('.model-tools').getByRole('button', { name: 'Undo' }).click();
    expect((await scene(page)).crop).toEqual(before);
    // Off keeps the box for later; the floor is back.
    await page.locator('.model-tools input[name=crop]').uncheck();
    expect((await scene(page)).crop).toEqual({ ...before, enabled: false });
    expect(errors).toEqual([]);
  });
});
