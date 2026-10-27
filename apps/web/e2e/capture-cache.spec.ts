import { type Page, expect, test } from '@playwright/test';
import { collectErrors, fixture, modelPoint, openApp, openViaPicker, scene, tapCanvas, toast, waitForModel, waitReady } from './helpers';

// Opened capture bundles are kept in OPFS (IndexedDB fallback) so a reload reopens them without
// the zip. Every test gets a fresh browser context, so storage starts empty.

const openButton = (page: Page) => page.locator('.open-menu > button');
const menu = (page: Page) => page.getByRole('menu');

/** Opens a bundle and waits until it is stored (the Open button turns into a menu). */
async function openAndStore(page: Page, name: string, expected: string): Promise<void> {
  await openViaPicker(page, fixture(name));
  await expect(toast(page)).toContainText(`Opened capture “${expected}”`);
  await expect(openButton(page)).toHaveAttribute('aria-haspopup', 'menu');
}

test.describe('stored captures', () => {
  test('a reload reopens the last capture from browser storage, with its comments', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await expect(openButton(page)).not.toHaveAttribute('aria-haspopup');
    await openAndStore(page, 'bike.bikecapture.zip', 'Fixture Gravel Bike');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await tapCanvas(page, await modelPoint(page));
    await page.locator('form.editor input[name=title]').fill('Paint chip');
    await page.locator('form.editor').getByRole('button', { name: 'Save' }).click();

    await page.reload();
    await waitReady(page);
    await expect(toast(page)).toHaveText('Reopened “Fixture Gravel Bike” from this browser’s storage.');
    await waitForModel(page);
    await expect(page.locator('#topbar .brand strong')).toHaveText('Fixture Gravel Bike');
    await expect(page.locator('.comments .comment', { hasText: 'Paint chip' })).toHaveCount(1);
    expect((await scene(page)).model.url).toBe('bundle:bike.bikecapture.zip/model.usdz');
    expect(errors).toEqual([]);
  });

  test('the Open menu lists stored captures, switches between them and forgets them', async ({ page }) => {
    await openApp(page);
    await openAndStore(page, 'bike.bikecapture.zip', 'Fixture Gravel Bike');
    await openAndStore(page, 'bike-glb.bikecapture.zip', 'Fixture GLB Bike');

    await openButton(page).click();
    await expect(openButton(page)).toHaveAttribute('aria-expanded', 'true');
    const items = menu(page).locator('.stored li');
    await expect(items).toHaveCount(2);
    // Most recently used first.
    await expect(items.locator('.stored-open span')).toHaveText(['Fixture GLB Bike', 'Fixture Gravel Bike']);
    await expect(items.locator('small').first()).toHaveText(/\d+(\.\d+)? (KB|MB)/);
    await expect(menu(page).locator('li.on')).toContainText('Fixture GLB Bike');

    // Escape and outside clicks close it.
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await openButton(page).click();
    await page.locator('#topbar .brand').click();
    await expect(menu(page)).toHaveCount(0);

    // Switch back to the first capture without its zip.
    await openButton(page).click();
    await menu(page).getByRole('menuitem', { name: /Fixture Gravel Bike/ }).click();
    await expect(toast(page)).toHaveText('Opened “Fixture Gravel Bike” from this browser’s storage.');
    await expect(page.locator('#topbar .brand strong')).toHaveText('Fixture Gravel Bike');
    expect((await scene(page)).model.format).toBe('usdz');

    // Forget both; with nothing stored, Open goes straight to the file picker again.
    await openButton(page).click();
    await menu(page).getByRole('button', { name: 'Forget Fixture GLB Bike' }).click();
    await expect(menu(page).locator('.stored li')).toHaveCount(1);
    await menu(page).getByRole('button', { name: 'Forget Fixture Gravel Bike' }).click();
    await expect(menu(page)).toHaveCount(0);
    await expect(openButton(page)).not.toHaveAttribute('aria-haspopup');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), openButton(page).click()]);
    expect(chooser.isMultiple()).toBe(false);

    // Forgotten means forgotten: a reload asks for the zip again.
    await page.reload();
    await waitReady(page);
    await expect(toast(page)).toHaveText('Drop “bike.bikecapture.zip” onto the viewer to reopen this capture.');
  });

  test('"Choose a file…" in the menu opens the file picker', async ({ page }) => {
    await openApp(page);
    await openAndStore(page, 'bike.bikecapture.zip', 'Fixture Gravel Bike');
    await openButton(page).click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), menu(page).getByRole('menuitem', { name: 'Choose a file…' }).click()]);
    await chooser.setFiles(fixture('bike-glb.bikecapture.zip'));
    await expect(toast(page)).toContainText('Opened capture “Fixture GLB Bike”');
  });
});
