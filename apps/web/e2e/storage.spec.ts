import { expect, test } from '@playwright/test';
import { collectErrors, modelPoint, openApp, openViaPicker, fixture, tapCanvas, toast, waitForModel } from './helpers';

// Private windows, disabled site data and some embedded browsers throw on any localStorage access.
// The app must still work, it just cannot remember anything.

test.describe('with localStorage blocked', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      });
    });
  });

  test('the demo, editing and capture import still work', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await waitForModel(page);
    await expect(page.locator('.comments .comment')).toHaveCount(7);
    expect(await page.evaluate(() => { try { localStorage; return 'readable'; } catch { return 'blocked'; } })).toBe('blocked');

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await tapCanvas(page, await modelPoint(page));
    await page.locator('form.editor input[name=title]').fill('Not persisted');
    await page.locator('form.editor').getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.comments .comment')).toHaveCount(8);

    await openViaPicker(page, fixture('bike.bikecapture.zip'));
    await expect(toast(page)).toContainText('Opened capture “Fixture Gravel Bike”');
    expect(errors).toEqual([]);

    // Nothing was saved: a reload starts from the demo again.
    await page.reload();
    await page.waitForFunction(() => window.__bike?.ready === true);
    await expect(page.locator('#topbar .brand strong')).toHaveText('Demo Road Bike');
    await expect(page.locator('.comments .comment')).toHaveCount(7);
  });
});
