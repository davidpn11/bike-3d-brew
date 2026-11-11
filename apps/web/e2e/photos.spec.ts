import { type Page, expect, test } from '@playwright/test';
import { PHOTO_BUNDLE, collectErrors, fixture, openApp, openViaPicker, snap, toast, waitReady } from './helpers';

// Photo close-ups: capture photos whose camera poses look most directly at an area, shown as a
// filmstrip and in a full-screen lightbox. The fixture's photos are real renders of the fixture
// bike from each pose (tools/fixtures/render-photos.mjs), decoded by the browser like JPEGs from
// a converted capture.

async function openWithArea(page: Page): Promise<void> {
  await openApp(page);
  await openViaPicker(page, fixture(PHOTO_BUNDLE));
  await expect(toast(page)).toContainText('Opened capture “Fixture Photo Bike”');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  page.once('dialog', (d) => void d.accept('Whole frame'));
  await page.getByRole('button', { name: '+ Save current view as area' }).click();
  await expect(page.locator('.areas li > button.on')).toContainText('Whole frame');
}

const strip = (page: Page) => page.getByRole('list', { name: 'Close-up photos: Whole frame' });
/**
 * Thumbnails the app finished preparing (extracted, decoded, downscaled to a JPEG object URL).
 * The <img> elements are loading="lazy", so the browser may not paint off-screen ones yet.
 */
const readyThumbs = (page: Page) => strip(page).locator('button:not(.loading):not(.missing) img[src^="blob:"]').count();

test.describe('photo close-ups', () => {
  test('an area shows its best photos; the lightbox steps with arrows and closes with Esc', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await openWithArea(page);
    await expect(page.locator('#panel section.photos h2')).toHaveText('Whole frame photos');
    const tiles = strip(page).getByRole('button');
    await expect(tiles.first()).toBeVisible();
    const count = await tiles.count();
    expect(count).toBeGreaterThan(1);
    expect(count).toBeLessThanOrEqual(8);
    await expect.poll(() => readyThumbs(page)).toBe(count);
    await expect(strip(page).locator('.missing')).toHaveCount(0);
    // The visible first thumbnail really decoded in the browser.
    await expect.poll(() => strip(page).locator('img').first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await snap(page, testInfo, 'filmstrip');

    await tiles.first().click();
    const box = page.getByRole('dialog', { name: 'Photo viewer' });
    await expect(box).toBeVisible();
    const counter = box.locator('.count');
    await expect(counter).toHaveText(`1 / ${count}`);
    await expect(box.locator('.caption')).toHaveText(/^Whole frame · IMG_\d{4}\.jpg$/);
    const full = box.locator('.lb-stage img');
    await expect.poll(() => full.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(400);
    await expect(box.locator('.status')).toBeHidden();
    await snap(page, testInfo, 'lightbox');

    await page.keyboard.press('ArrowRight');
    await expect(counter).toHaveText(`2 / ${count}`);
    await box.getByRole('button', { name: 'Previous photo' }).click();
    await expect(counter).toHaveText(`1 / ${count}`);
    await page.keyboard.press('ArrowLeft');
    await expect(counter).toHaveText(`${count} / ${count}`);
    await box.getByRole('button', { name: 'Next photo' }).click();
    await expect(counter).toHaveText(`1 / ${count}`);

    // Keys go to the lightbox, not to the app behind it; Esc closes only the lightbox.
    await page.keyboard.press('Escape');
    await expect(box).toBeHidden();
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'edit');
    await tiles.nth(1).click();
    await expect(counter).toHaveText(`2 / ${count}`);
    await box.getByRole('button', { name: 'Close photo' }).click();
    await expect(box).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('present mode shows the area photos too', async ({ page }) => {
    await openWithArea(page);
    await page.getByRole('button', { name: 'Present', exact: true }).click();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.present-card header strong')).toHaveText('Whole frame');
    await expect(page.locator('.present-card').getByRole('list', { name: 'Close-up photos: Whole frame' }).getByRole('button').first()).toBeVisible();
  });

  test('after a reload the viewed photos come from browser storage', async ({ page }) => {
    await openWithArea(page);
    const tiles = strip(page).getByRole('button');
    await expect(tiles.first()).toBeVisible();
    const count = await tiles.count();
    await expect.poll(() => readyThumbs(page)).toBe(count);
    // Thumbnails are written to the cache in the background; wait until they are all there.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const root = await navigator.storage.getDirectory();
          const dir = await root.getDirectoryHandle('bike-captures');
          let n = 0;
          for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) if (decodeURIComponent(name).includes('/f/thumb/')) n++;
          return n;
        }),
      )
      .toBe(count);

    await page.reload();
    await waitReady(page);
    await expect(toast(page)).toContainText('Reopened “Fixture Photo Bike”');
    await page.getByRole('button', { name: /^Whole frame/ }).click();
    await expect.poll(() => readyThumbs(page)).toBe(count);
    await expect(page.locator('#panel .photo-block .hint')).toHaveText('Photos kept in this browser. Drop “bike-photos.bikecapture.zip” to load any others.');
  });
});
