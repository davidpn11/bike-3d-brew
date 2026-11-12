import { test, expect } from '@playwright/test';

test('Studio library filters, opens workspace and publishes', async ({ page }) => {
  await page.goto('/proto.html#studio');
  await expect(page.locator('.p-bike-card')).toHaveCount(4);
  await page.getByLabel('Type', { exact: true }).selectOption('Gravel');
  await expect(page.locator('.p-bike-card')).toHaveCount(1);
  await expect(page.locator('.p-bike-name')).toHaveText('Trail GX');
  await page.getByLabel('Type', { exact: true }).selectOption('all');
  await page.getByRole('button', { name: /Aero R1/ }).click();
  await expect(page).toHaveURL(/#workspace\?bike=aero-r1/);
  await page.getByRole('button', { name: 'Publish update' }).click();
  await expect(page.getByRole('status')).toHaveText('Aero R1 published');
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
