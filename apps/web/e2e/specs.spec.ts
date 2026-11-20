import { type Page, expect, test } from './test';
import { collectErrors, openApp, readDownload, scene, snap } from './helpers';

const specTable = (page: Page) => page.locator('.present-card table.specs');
const tableRows = (page: Page) => specTable(page).locator('tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent)));

test.describe('spec sheet', () => {
  test('staff edit the specs; Present mode and Export show them', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await openApp(page);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = page.locator('.spec-sheet');
    await expect(editor.locator('.spec-row')).toHaveCount(6);
    await editor.scrollIntoViewIfNeeded();
    await snap(page, testInfo, 'specs-editor');

    // Change a value, remove a row, add a free-form one (saved once it has text).
    await editor.getByLabel('Weight value').fill('7.9 kg (size 54)');
    await editor.getByLabel('Weight value').press('Tab');
    await editor.getByRole('button', { name: 'Remove Brakes' }).click();
    await editor.getByRole('button', { name: '+ Add spec' }).click();
    await editor.locator('.spec-row').last().getByLabel('Spec name').fill('Warranty');
    // Like a person: Tab to the value and keep typing (saving re-renders the panel without losing focus).
    await page.keyboard.press('Tab');
    await expect(editor.getByLabel('Warranty value')).toBeFocused();
    await page.keyboard.type('Lifetime, frame and fork');
    await page.keyboard.press('Tab');
    const expected = [
      ['Frame material', 'Carbon, aero tube shapes'],
      ['Groupset', 'Shimano 105 Di2, 2×12'],
      ['Weight', '7.9 kg (size 54)'],
      ['Sizes', '49, 52, 54, 56, 58, 61'],
      ['Tyre clearance', '32 mm'],
      ['Warranty', 'Lifetime, frame and fork'],
    ];
    await expect.poll(async () => (await scene(page)).specs?.map((r) => [r.label, r.value])).toEqual(expected);

    // A cleared value hides the row from customers but keeps it for staff.
    await editor.getByLabel('Tyre clearance value').fill('');
    await editor.getByLabel('Tyre clearance value').press('Tab');
    await expect.poll(async () => (await scene(page)).specs?.find((r) => r.label === 'Tyre clearance')?.value).toBe('');

    await page.getByRole('button', { name: 'Present', exact: true }).click();
    await expect(specTable(page)).toBeVisible();
    expect(await tableRows(page)).toEqual(expected.filter(([l]) => l !== 'Tyre clearance'));
    await snap(page, testInfo, 'specs-present');
    // Only on the whole-bike step.
    await page.keyboard.press('ArrowRight');
    await expect(specTable(page)).toHaveCount(0);
    await page.keyboard.press('Escape');

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
    const exported = JSON.parse((await readDownload(download)).toString('utf8'));
    expect(exported.specs).toContainEqual({ label: 'Warranty', value: 'Lifetime, frame and fork' });
    expect(errors).toEqual([]);
  });

  test('the customer link shows the published spec sheet', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await openApp(page, 'scene=scenes/demo/scene.bike.json&view=present');
    await expect(specTable(page)).toBeVisible();
    expect((await tableRows(page)).map(([l]) => l)).toEqual(['Frame material', 'Groupset', 'Weight', 'Sizes', 'Brakes', 'Tyre clearance']);
    await snap(page, testInfo, 'specs-link');
    expect(errors).toEqual([]);
  });
});
