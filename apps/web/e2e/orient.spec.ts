import { type Page, expect, test } from '@playwright/test';
import { collectErrors, fixture, modelPoint, openApp, openViaPicker, scene, snap, tapCanvas, toast, waitForCamera, waitForModel } from './helpers';

/** World-space size and lowest point of the model as currently placed (exact vertex bounds). */
const placement = (page: Page) =>
  page.evaluate(() => {
    const { viewer, store } = window.__bike!;
    const m = store.scene.model;
    const box = viewer.boundsWith(m);
    const off = m.offset ?? [0, 0, 0];
    return { size: [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z], bottom: box.min.y + off[1] };
  });

/** Distance between a comment's saved point and the nearest surface point under its pin on screen. */
const pinDrift = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    // Pins are positioned per frame: let the layer catch up with the latest change first.
    for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
    const { viewer, store } = window.__bike!;
    const a = store.scene.annotations.find((x) => x.id === id)!;
    const pin = document.querySelector<HTMLElement>(`.pin-layer .pin[aria-label^="Comment 1"]`)!.getBoundingClientRect();
    // Thin tubes: probe a few pixels around the pin centre and keep the closest surface hit.
    let best = Infinity;
    for (let dx = -4; dx <= 4; dx += 2) {
      for (let dy = -4; dy <= 4; dy += 2) {
        const hit = viewer.pick(pin.x + pin.width / 2 + dx, pin.y + pin.height / 2 + dy);
        if (hit) best = Math.min(best, Math.hypot(...hit.position.map((v, i) => v - a.position[i])));
      }
    }
    return best;
  }, id);

test.describe('auto-orient', () => {
  test('stands a tilted capture upright; Model panel rotations keep comments attached', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await openApp(page);
    await openViaPicker(page, fixture('tilted-bike.bikecapture.zip'));
    await expect(toast(page)).toContainText('Auto-oriented. Undo in Edit → Model');
    await waitForModel(page);
    const oriented = await scene(page);
    expect(oriented.model.rotation).toHaveLength(3);
    // Upright with its length along X: ~1.7 m long, ~1 m tall, narrow, standing on y = 0.
    let p = await placement(page);
    expect(p.size[0]).toBeGreaterThan(1.5);
    expect(p.size[1]).toBeGreaterThan(0.85);
    expect(p.size[1]).toBeLessThan(1.15);
    expect(p.size[2]).toBeLessThan(0.6);
    expect(Math.abs(p.bottom)).toBeLessThan(0.005);
    await snap(page, testInfo, 'auto-oriented');

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await tapCanvas(page, await modelPoint(page));
    await page.locator('form.editor input[name=title]').fill('Pinned before rotating');
    await page.locator('form.editor').getByRole('button', { name: 'Save' }).click();
    const note = (await scene(page)).annotations[0];
    expect(await pinDrift(page, note.id)).toBeLessThan(0.03);

    await page.locator('.model-tools button[title="Rotate +90° about Y"]').click();
    await waitForCamera(page);
    const turned = await scene(page);
    expect(turned.model.rotation).not.toEqual(oriented.model.rotation);
    // Comments live in model-root space: the saved point is untouched and the pin still sits on it.
    expect(turned.annotations[0].position).toEqual(note.position);
    expect(await pinDrift(page, note.id)).toBeLessThan(0.03);
    p = await placement(page);
    expect(p.size[2]).toBeGreaterThan(1.5); // now lengthwise along Z
    await expect(page.locator('.model-tools input[name=length]')).toHaveValue(/^1[67]\d$/);
    await snap(page, testInfo, 'rotated-y');

    await page.locator('.model-tools').getByRole('button', { name: 'Undo' }).click();
    expect((await scene(page)).model.rotation).toEqual(oriented.model.rotation);
    expect(errors).toEqual([]);
  });

  test('Undo after auto-orient keeps the capture as loaded and it is not re-oriented', async ({ page }) => {
    await openApp(page);
    await openViaPicker(page, fixture('tilted-bike.bikecapture.zip'));
    await expect(toast(page)).toContainText('Auto-oriented');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('.model-tools').getByRole('button', { name: 'Undo' }).click();
    expect((await scene(page)).model.rotation).toEqual([0, 0, 0]);
    await openViaPicker(page, fixture('tilted-bike.bikecapture.zip'));
    await expect(toast(page)).toContainText('Opened capture “Tilted Fixture Bike”');
    await expect(toast(page)).not.toContainText('Auto-oriented');
    expect((await scene(page)).model.rotation).toEqual([0, 0, 0]);
  });
});
