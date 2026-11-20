import { test, expect } from '@playwright/test';

async function expectWorkspacePresenterReady(page: import('@playwright/test').Page): Promise<void> {
  const host = page.locator('.p-w-presenter');
  await expect(host).toHaveAttribute('data-presenter-ready', 'true', { timeout: 30_000 });
  await expect(host.locator('.link-error')).toHaveCount(0);
  const canvas = host.locator('canvas');
  await expect(canvas).toHaveCount(1);
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(200);
  expect(box?.height).toBeGreaterThan(150);

  const screenshot = await canvas.screenshot();
  const luminanceStdDev = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const surface = document.createElement('canvas');
    surface.width = image.width;
    surface.height = image.height;
    const context = surface.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, surface.width, surface.height);
    const values: number[] = [];
    for (let y = Math.floor(surface.height * 0.25); y < surface.height * 0.75; y += 4) {
      for (let x = Math.floor(surface.width * 0.25); x < surface.width * 0.75; x += 4) {
        const offset = (y * surface.width + x) * 4;
        values.push(0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]);
      }
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  }, screenshot.toString('base64'));
  expect(luminanceStdDev).toBeGreaterThan(15);
}

test('Studio library filters, opens workspace and publishes', async ({ page }) => {
  await page.goto('/proto.html#studio');
  await expect(page.locator('.p-bike-card')).toHaveCount(4);
  await page.getByLabel('Type', { exact: true }).selectOption('Gravel');
  await expect(page.locator('.p-bike-card')).toHaveCount(1);
  await expect(page.locator('.p-bike-name')).toHaveText('Trail GX');
  await page.getByLabel('Type', { exact: true }).selectOption('all');
  await page.getByRole('button', { name: /Aero R1/ }).click();
  await expect(page).toHaveURL(/#workspace\?bike=aero-r1/);
  await expectWorkspacePresenterReady(page);
  await page.getByRole('button', { name: 'Publish update' }).click();
  await expect(page.getByRole('status')).toHaveText('Aero R1 published');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/proto.html#workspace?bike=aero-r1');
  await expectWorkspacePresenterReady(page);
});

test('Messages status stays changed while viewing the page', async ({ page }) => {
  await page.goto('/proto.html#studio?tab=messages');
  await expect(page.locator('.p-message')).toHaveCount(3);
  const status = page.getByLabel('Status for Jordan P.');
  await status.selectOption('replied');
  await expect(status).toHaveValue('replied');
  await page.getByLabel('Status for Sam R.').selectOption('test ride booked');
  await expect(page.getByLabel('Status for Sam R.')).toHaveValue('test ride booked');
});

test('Storefront card opens its bike page hash', async ({ page }) => {
  await page.goto('/proto.html#storefront');
  await page.getByRole('button', { name: /Aero R1/ }).click();
  await expect(page).toHaveURL(/#bike\?bike=aero-r1/);
});
