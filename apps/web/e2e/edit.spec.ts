import { type Page, expect, test } from '@playwright/test';
import { collectErrors, modelPoint, openApp, scene, snap, tapCanvas } from './helpers';

async function enterEdit(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'edit');
}

/** Taps the bike and fills the comment editor. */
async function addComment(page: Page, title: string, extra: { body?: string; kind?: string; price?: string } = {}): Promise<void> {
  await tapCanvas(page, await modelPoint(page));
  const form = page.locator('form.editor');
  await expect(form.getByRole('heading')).toHaveText('New comment');
  await form.locator('input[name=title]').fill(title);
  if (extra.body) await form.locator('textarea[name=body]').fill(extra.body);
  if (extra.kind) await form.locator('select[name=kind]').selectOption(extra.kind);
  if (extra.price) await form.locator('input[name=price]').fill(extra.price);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
}

test.describe('edit mode', () => {
  test('adds, edits and deletes a comment picked on the model', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await openApp(page);
    await enterEdit(page);
    await expect(page.locator('.toast')).toContainText('Edit mode');

    await addComment(page, 'Hand-built wheels', { body: 'Trued in the shop.', kind: 'upgrade', price: '+$450' });
    const card = page.locator('.comments .comment', { hasText: 'Hand-built wheels' });
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute('data-kind', 'upgrade');
    await expect(card).toContainText('+$450');
    await expect(card).toContainText('Trued in the shop.');
    await expect(page.locator('.pin-layer .pin')).toHaveCount(8);
    await expect(page.locator('.pin-layer .pin.active')).toHaveAttribute('aria-label', 'Comment 8: Hand-built wheels');
    const added = (await scene(page)).annotations.at(-1)!;
    expect(added).toMatchObject({ title: 'Hand-built wheels', kind: 'upgrade', price: '+$450' });
    // Picked on the model surface: a point near the bike and a unit normal.
    expect(Math.hypot(...added.position)).toBeLessThan(2);
    expect(Math.hypot(...added.normal!)).toBeCloseTo(1, 2);
    await snap(page, testInfo, 'comment-added');

    await card.getByRole('button', { name: 'Edit' }).click();
    const form = page.locator('form.editor');
    await expect(form.getByRole('heading')).toHaveText('Edit comment');
    await expect(form.locator('input[name=title]')).toHaveValue('Hand-built wheels');
    await form.locator('input[name=title]').fill('Hand-built carbon wheels');
    await form.locator('select[name=kind]').selectOption('feature');
    await form.getByRole('button', { name: 'Save' }).click();
    const edited = page.locator('.comments .comment', { hasText: 'Hand-built carbon wheels' });
    await expect(edited).toHaveAttribute('data-kind', 'feature');
    expect((await scene(page)).annotations.at(-1)!.position).toEqual(added.position);

    page.once('dialog', (d) => void d.accept());
    await edited.getByRole('button', { name: 'Delete' }).click();
    await expect(edited).toHaveCount(0);
    await expect(page.locator('.pin-layer .pin')).toHaveCount(7);
    expect(errors).toEqual([]);
  });

  test('comments survive a reload (local storage)', async ({ page }) => {
    await openApp(page);
    await enterEdit(page);
    await addComment(page, 'Saved locally');
    await page.reload();
    await page.waitForFunction(() => window.__bike?.ready === true);
    await expect(page.locator('.comments .comment', { hasText: 'Saved locally' })).toHaveCount(1);
  });

  test('cancel and Escape discard a draft; a dismissed delete keeps the comment', async ({ page }) => {
    await openApp(page);
    await enterEdit(page);
    await tapCanvas(page, await modelPoint(page));
    await page.locator('form.editor').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('form.editor')).toHaveCount(0);

    await tapCanvas(page, await modelPoint(page));
    await expect(page.locator('form.editor')).toHaveCount(1);
    await page.locator('#panel h2', { hasText: 'Areas' }).click(); // move focus out of the form
    await page.keyboard.press('Escape');
    await expect(page.locator('form.editor')).toHaveCount(0);

    page.once('dialog', (d) => void d.dismiss());
    await page.locator('.comments .comment').first().getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.comments .comment')).toHaveCount(7);
  });

  test('new comments default to the focused area', async ({ page }) => {
    await openApp(page);
    await enterEdit(page);
    await page.getByRole('button', { name: /^Cockpit \d/ }).click();
    await tapCanvas(page, await modelPoint(page));
    const cockpitId = (await scene(page)).hotspots.find((h) => h.name === 'Cockpit')!.id;
    await expect(page.locator('form.editor select[name=area]')).toHaveValue(cockpitId);
  });

  test('saves, renames and deletes areas', async ({ page }) => {
    await openApp(page);
    await enterEdit(page);
    page.once('dialog', (d) => void d.accept('Rear derailleur'));
    await page.getByRole('button', { name: '+ Save current view as area' }).click();
    const row = page.locator('.areas li', { hasText: 'Rear derailleur' });
    await expect(row).toHaveCount(1);
    await expect(row.locator('> button')).toHaveClass(/\bon\b/);

    page.once('dialog', (d) => void d.accept('Rear mech'));
    await row.getByRole('button', { name: 'Rename' }).click();
    const renamed = page.locator('.areas li', { hasText: 'Rear mech' });
    await expect(renamed).toHaveCount(1);
    await renamed.getByRole('button', { name: 'Set view' }).click();

    page.once('dialog', (d) => void d.accept());
    await renamed.getByTitle('Delete area').click();
    await expect(renamed).toHaveCount(0);
    expect((await scene(page)).hotspots).toHaveLength(6);
  });

  test('edits the bike details', async ({ page }) => {
    await openApp(page);
    await enterEdit(page);
    const details = page.locator('section.details');
    await details.getByLabel('Name').fill('Aero R1 Team');
    await details.getByLabel('Name').press('Enter'); // change event
    await details.getByLabel('Price').fill('$4,999');
    await details.getByLabel('Price').blur();
    await expect(page.locator('#topbar .brand')).toContainText('Aero R1 Team');
    await expect(page.locator('#topbar .brand .price')).toHaveText('$4,999');
  });
});
