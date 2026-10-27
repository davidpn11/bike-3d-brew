import { expect, test } from '@playwright/test';
import { openApp, snap, waitForCamera } from './helpers';

test.describe('present mode', () => {
  test('steps through the areas with keys and buttons, wrapping around', async ({ page }, testInfo) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Present', exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'present');
    await expect(page.locator('#panel')).toBeHidden();
    const card = page.locator('.present-card');
    const step = card.locator('header small');
    const title = card.locator('header strong');
    await expect(step).toHaveText('1 / 7');
    await expect(title).toHaveText('Demo Road Bike');
    await expect(card.locator('.lede')).toHaveText('Brew Cycles · Aero R1 · 2026');

    await page.keyboard.press('ArrowRight');
    await expect(step).toHaveText('2 / 7');
    await expect(title).toHaveText('Fork');
    await expect(card.locator('li')).toHaveCount(2);
    await snap(page, testInfo, 'present-fork');

    await card.getByRole('button', { name: 'Next area' }).click();
    await expect(title).toHaveText('Drivetrain');
    await page.keyboard.press(' ');
    await expect(title).toHaveText('Cockpit');
    await card.getByRole('button', { name: 'Previous area' }).click();
    await expect(title).toHaveText('Drivetrain');

    // Tapping a comment highlights it and its pin.
    await card.locator('li', { hasText: 'Upgrade to Ultegra Di2' }).click();
    await expect(card.locator('li.on')).toContainText('Upgrade to Ultegra Di2');
    await expect(card.locator('li.on .price')).toHaveText('+$900');
    await waitForCamera(page);

    // Back past the first step wraps to the last, and forward from the last to the first.
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
    await expect(step).toHaveText('7 / 7');
    await expect(title).toHaveText('Frame');
    await page.keyboard.press('ArrowRight');
    await expect(step).toHaveText('1 / 7');

    await page.keyboard.press('Escape');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'view');
    await expect(card).toBeHidden();
    await expect(page.locator('#panel')).toBeVisible();
  });

  test('?mode=present opens straight into present mode', async ({ page }) => {
    await openApp(page, 'mode=present');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'present');
    await expect(page.locator('.present-card header small')).toHaveText('1 / 7');
  });
});
