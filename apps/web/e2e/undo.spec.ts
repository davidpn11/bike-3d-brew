import { type Page, expect, test } from './test';
import { collectErrors, modelPoint, openApp, scene, snap, tapCanvas, waitReady } from './helpers';

const titles = async (page: Page) => (await scene(page)).annotations.map((a) => a.title);
const areas = async (page: Page) => (await scene(page)).hotspots.map((h) => h.name);

test.describe('undo / redo', () => {
  test('undoes and redoes comment and area edits by button and keyboard, and the result survives a reload', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await openApp(page);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const undo = page.getByRole('button', { name: '↶ Undo' });
    const redo = page.getByRole('button', { name: '↷ Redo' });
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    const original = await titles(page);

    // Add a comment, move it up, delete it, add an area: four steps.
    await tapCanvas(page, await modelPoint(page));
    const form = page.locator('form.editor');
    await form.locator('input[name=title]').fill('Undo me');
    await form.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Move “Undo me” up' }).click();
    page.once('dialog', (d) => void d.accept());
    await page.locator('.comments .comment', { hasText: 'Undo me' }).getByRole('button', { name: 'Delete' }).click();
    page.once('dialog', (d) => void d.accept('Rear mech'));
    await page.getByRole('button', { name: '+ Save current view as area' }).click();
    expect(await titles(page)).toEqual(original);
    expect(await areas(page)).toContain('Rear mech');
    await snap(page, testInfo, 'before-undo');

    await undo.click(); // area gone
    expect(await areas(page)).not.toContain('Rear mech');
    await page.keyboard.press('ControlOrMeta+z'); // comment back, in its moved place
    expect((await titles(page)).at(-2)).toBe('Undo me');
    await page.keyboard.press('ControlOrMeta+z'); // move undone
    expect((await titles(page)).at(-1)).toBe('Undo me');
    // Open the comment in the editor, then undo its creation: the editor goes away with it.
    await page.locator('.comments .comment', { hasText: 'Undo me' }).getByRole('button', { name: 'Edit' }).click();
    await expect(form.locator('input[name=title]')).toHaveValue('Undo me');
    await undo.click(); // comment gone
    expect(await titles(page)).toEqual(original);
    await expect(form).toHaveCount(0);
    await expect(undo).toBeDisabled();
    await expect(page.locator('.pin-layer .pin')).toHaveCount(original.length);

    await redo.click();
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect((await titles(page)).at(-2)).toBe('Undo me');
    await page.keyboard.press('Control+y');
    expect(await titles(page)).toEqual(original);
    await expect(redo).toBeEnabled();
    await snap(page, testInfo, 'redone');

    // Typing in a field keeps the browser's own undo; the scene is untouched.
    const name = page.locator('.details input').first();
    await name.fill('Typed');
    await name.press('ControlOrMeta+z');
    expect(await titles(page)).toEqual(original);
    await expect(redo).toBeEnabled();

    // Stopped one step short of the area: that is what was saved.
    await page.reload();
    await waitReady(page);
    expect(await areas(page)).not.toContain('Rear mech');
    expect(await titles(page)).toEqual(original);
    expect(errors).toEqual([]);
  });

  test('undo is only for Edit mode', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    page.once('dialog', (d) => void d.accept('Kept'));
    await page.getByRole('button', { name: '+ Save current view as area' }).click();
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.keyboard.press('ControlOrMeta+z');
    expect(await areas(page)).toContain('Kept');
    await expect(page.getByRole('button', { name: '↶ Undo' })).toHaveCount(0);
  });
});
