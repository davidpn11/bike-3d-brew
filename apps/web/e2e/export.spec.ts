import { type Page, expect, test } from '@playwright/test';
import { collectErrors, openApp, readDownload, snap, waitForModel } from './helpers';

/** The top-left pixel (RGBA) and the share of fully opaque pixels of a PNG, decoded by the browser. */
async function decode(page: Page, png: Buffer): Promise<{ corner: number[]; opaque: number }> {
  return page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob(), { premultiplyAlpha: 'none' });
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] === 255) opaque++;
    return { corner: [...data.subarray(0, 4)], opaque: opaque / (data.length / 4) };
  }, png.toString('base64'));
}

async function savePng(page: Page): Promise<{ name: string; png: Buffer }> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save PNG' }).click()]);
  return { name: download.suggestedFilename(), png: await readDownload(download) };
}

test.describe('snapshot / video export', () => {
  test('saves a 2× PNG with alpha, a chroma-green one, and restores the stage', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await openApp(page);
    await waitForModel(page);
    const before = await page.evaluate(() => {
      const { viewer } = window.__bike!;
      return { stage: { ...viewer.viewport }, buffer: [viewer.renderer.domElement.width, viewer.renderer.domElement.height] };
    });
    await expect(page.getByRole('button', { name: 'Save PNG' })).toBeHidden();
    await page.getByRole('button', { name: 'Snapshot' }).click();
    await expect(page.getByRole('button', { name: 'Save PNG' })).toBeVisible();
    await snap(page, testInfo, 'export-menu');
    const form = page.locator('.export-form');

    await form.getByLabel('Background').selectOption('transparent');
    await form.getByLabel('Show pins').check();
    const { width, height } = { width: before.stage.width * 2, height: before.stage.height * 2 };
    let { name, png } = await savePng(page);
    expect(name).toBe(`demo-road-bike-transparent-${width}x${height}.png`);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20), png[25]]).toEqual([width, height, 6]); // IHDR: size, RGBA
    const clear = await decode(page, png);
    expect(clear.corner[3]).toBe(0); // see-through backdrop
    expect(clear.opaque).toBeGreaterThan(0.01); // the bike
    expect(clear.opaque).toBeLessThan(0.5);

    await form.getByLabel('Size').selectOption('1');
    await form.getByLabel('Background').selectOption('green');
    ({ name, png } = await savePng(page));
    expect(name).toBe(`demo-road-bike-green-${before.stage.width}x${before.stage.height}.png`);
    const green = await decode(page, png);
    expect(green.corner).toEqual([0x00, 0xb1, 0x40, 255]);
    expect(green.opaque).toBe(1);

    // The stage got its drawing buffer and clear color back.
    const after = await page.evaluate(() => {
      const { viewer } = window.__bike!;
      return { buffer: [viewer.renderer.domElement.width, viewer.renderer.domElement.height], alpha: viewer.renderer.getClearAlpha() };
    });
    expect(after).toEqual({ buffer: before.buffer, alpha: 0 });
    // Escape closes the menu.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Save PNG' })).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('records a turntable WebM and puts the camera back', async ({ page }) => {
    await openApp(page);
    await waitForModel(page);
    const camera = () => page.evaluate(() => window.__bike!.viewer.camera.position.toArray());
    const start = await camera();
    // 3 s, not 1: the encoder drops frames while it starts, and a loaded CI runner draws only a few per second.
    await page.evaluate(() => (window.__bike!.app.turntableSeconds = 3));
    await page.getByRole('button', { name: 'Snapshot' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Record 360° WebM' }).click()]);
    expect(download.suggestedFilename()).toBe('demo-road-bike-turntable.webm');
    const webm = await readDownload(download);
    expect([...webm.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]); // EBML header
    expect(webm.length).toBeGreaterThan(1_000);
    const end = await camera();
    end.forEach((v, i) => expect(v).toBeCloseTo(start[i], 4));
    await expect(page.getByRole('button', { name: 'Record 360° WebM' })).toBeEnabled();
  });
});
