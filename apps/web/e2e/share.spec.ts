import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { publishScene } from '../../../tools/publish-scene.mjs';
import { collectErrors, fixture, modelPoint, openApp, openViaPicker, readDownload, scene, snap, tapCanvas, toast, waitForCamera, waitForModel } from './helpers';

const DEMO_LINK = 'scene=scenes/demo/scene.bike.json&view=present';
const card = (page: Page) => page.locator('.present-card');
const stepLabel = (page: Page) => card(page).locator('header small');
const title = (page: Page) => card(page).locator('header strong');

test.describe('customer link (read-only present)', () => {
  test('shows only the bike, its comments and navigation', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await openApp(page, DEMO_LINK);
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'present');
    await expect(page.locator('body')).toHaveAttribute('data-readonly', 'true');
    // No editing UI at all: modes, backgrounds, Open/Export/Snapshot are gone; Share stays.
    for (const name of ['View', 'Edit', 'Present', 'Open…', 'Export', 'Snapshot', 'Studio']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(page.locator('input[type=file]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeVisible();
    await expect(page.locator('#panel')).toBeHidden();
    await expect(page.locator('.bp-bar .brand strong')).toHaveText('Demo Road Bike');
    await expect(stepLabel(page)).toHaveText('1 / 7');
    await expect(card(page).locator('.dots button')).toHaveCount(7);
    await snap(page, testInfo, 'link-overview');

    // Arrows, dots and the ‹ › buttons navigate; Escape does not leave Present mode.
    await page.keyboard.press('ArrowRight');
    await expect(title(page)).toHaveText('Fork');
    await card(page).getByRole('button', { name: 'Next area' }).click();
    await expect(title(page)).toHaveText('Drivetrain');
    // Markdown-lite from the published scene.
    const shifting = card(page).locator('li.note', { hasText: 'Shimano 105 Di2' });
    await expect(shifting.locator('.md strong')).toHaveText('Electronic shifting');
    await expect(shifting.locator('.md li')).toHaveText(['Charges over USB-C', 'About 1,000 km per charge']);
    await shifting.click();
    await expect(shifting).toHaveClass(/on/);
    await expect(page.locator('.leader-layer line.active')).toHaveCount(1);
    await waitForCamera(page);
    await snap(page, testInfo, 'link-drivetrain');
    await card(page).getByRole('tab', { name: 'Wheels' }).click();
    await expect(title(page)).toHaveText('Wheels');
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'present');

    // The editor is not even loaded: no stage to drop files on, no panel, no comment editor.
    expect(await page.evaluate(() => [document.getElementById('stage'), document.getElementById('panel'), document.querySelector('form.editor')])).toEqual([null, null, null]);
    expect((await scene(page)).id).toBe('demo-published');
    expect(errors).toEqual([]);
  });

  test('swiping the card changes area', async ({ page }) => {
    await openApp(page, DEMO_LINK);
    const box = (await card(page).boundingBox())!;
    const y = box.y + 20;
    const swipe = async (from: number, to: number) => {
      await card(page).dispatchEvent('pointerdown', { clientX: from, clientY: y, pointerId: 7, bubbles: true });
      await card(page).dispatchEvent('pointerup', { clientX: to, clientY: y + 4, pointerId: 7, bubbles: true });
    };
    await swipe(box.x + box.width - 20, box.x + 20);
    await expect(title(page)).toHaveText('Fork');
    await swipe(box.x + 20, box.x + box.width - 20);
    await expect(title(page)).toHaveText('Demo Road Bike');
  });

  test('a customer always sees the published copy, not local edits', async ({ page }) => {
    await openApp(page, 'scene=scenes/demo/scene.bike.json');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('.details input').first().fill('Locally renamed');
    await page.locator('.details input').first().press('Tab');
    await expect(page.locator('#topbar .brand strong')).toHaveText('Locally renamed');
    await openApp(page, DEMO_LINK);
    await expect(page.locator('.bp-bar .brand strong')).toHaveText('Demo Road Bike');
  });

  test('bad links explain themselves', async ({ page }) => {
    await openApp(page, 'scene=http://evil.example/s.json&view=present');
    await expect(page.locator('.link-error')).toContainText('This bike can’t be shown right now');
    await expect(page.locator('.link-error')).toContainText('must be on this site or use https');
    await page.route('**/scenes/local-only/scene.bike.json', (route) =>
      route.fulfill({ json: { schema: 'bike-scene/1', id: 'x', name: 'Local Only', model: { url: 'bundle:x.bikecapture.zip/model.usdz', format: 'usdz' }, hotspots: [], annotations: [] } }),
    );
    await openApp(page, 'scene=scenes/local-only/scene.bike.json&view=present');
    await expect(page.locator('.link-error')).toContainText('was shared without its 3D model');
    await page.route('**/scenes/broken/scene.bike.json', (route) => route.fulfill({ body: '{"schema":"bike-scene/1"' }));
    await openApp(page, 'scene=scenes/broken/scene.bike.json&view=present');
    await expect(page.locator('.link-error')).toContainText('Could not load scene scenes/broken/scene.bike.json');
  });
});

test.describe('share button', () => {
  test('copies the customer link of a published scene', async ({ page, context, browserName }, testInfo) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(testInfo.project.use.baseURL!).origin });
    await page.addInitScript(() => Object.defineProperty(navigator, 'share', { value: undefined }));
    await openApp(page, 'scene=scenes/demo/scene.bike.json');
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Share with a customer' });
    await expect(dialog).toBeVisible();
    const expected = `${new URL(testInfo.project.use.baseURL!).origin}/?scene=scenes/demo/scene.bike.json&view=present`;
    await expect(dialog.locator('.share-url')).toHaveValue(expected);
    await expect(dialog.locator('.share-status')).toHaveText(/Link copied/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
    await snap(page, testInfo, 'share-link');
    expect(browserName).toBe('chromium');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('falls back to a visible, selected link field when the clipboard is blocked', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined });
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) } });
    });
    await openApp(page, 'scene=scenes/demo/scene.bike.json');
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.share-status')).toHaveText(/Copy the link above/);
    await expect(dialog.locator('.share-url')).toBeFocused();
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement).value.slice(0, 7) === 'http://' && getSelection() !== null)).toBe(true);
  });

  test('flags local edits that the published copy lacks', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'share', { value: undefined }));
    await openApp(page, 'scene=scenes/demo/scene.bike.json');
    await page.getByRole('button', { name: 'Studio' }).click();
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(page.locator('.share-warn')).toContainText('not in the published copy');
  });
});

test.describe('share package → publish-scene → ?scene', () => {
  test('a local capture is exported, published with the tool and opens from the link', async ({ page }, testInfo) => {
    test.slow();
    const errors = collectErrors(page);
    page.on('dialog', (d) => void d.accept('Front end'));
    await openApp(page);
    await openViaPicker(page, fixture('bike-glb.bikecapture.zip'));
    await expect(toast(page)).toContainText('Opened capture “Fixture GLB Bike”');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: '+ Save current view as area' }).click();
    await expect(page.locator('.areas li', { hasText: 'Front end' })).toHaveCount(1);
    await tapCanvas(page, await modelPoint(page));
    const form = page.locator('form.editor');
    await form.locator('input[name=title]').fill('Hand-built wheels');
    await form.locator('textarea[name=body]').fill('Trued **in store**.\n- Tubeless\n- 28 spokes');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.comments .comment')).toHaveCount(1);

    // Local model: Share explains publishing and exports a package.
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Publish to share' });
    await expect(dialog).toContainText('only exists in this browser');
    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export share package' }).click()]);
    expect(download.suggestedFilename()).toBe('fixture-glb-bike.bikeshare.zip');
    await expect(toast(page)).toContainText('Saved fixture-glb-bike.bikeshare.zip');

    // The owner's step: tools/publish-scene.mjs installs it as a static scene.
    const dir = mkdtempSync(join(tmpdir(), 'bikeshare-'));
    try {
      const zipPath = join(dir, download.suggestedFilename());
      writeFileSync(zipPath, await readDownload(download));
      const published = await publishScene({ file: zipPath, out: join(dir, 'scenes'), id: `e2e-${testInfo.project.name}` });
      expect(published.files).toEqual(expect.arrayContaining(['scene.bike.json', 'bike-share.json', 'model.glb']));
      const photos = published.files.filter((f: string) => f.startsWith('photos/'));
      expect(photos.length).toBeGreaterThan(0);
      await expect(publishScene({ file: zipPath, out: join(dir, 'scenes'), id: `e2e-${testInfo.project.name}` })).rejects.toThrow(/already exists/);

      // Serve the published folder like a static host would.
      await page.route(`**/scenes/${published.id}/**`, (route) => {
        const path = decodeURIComponent(new URL(route.request().url()).pathname.split(`/scenes/${published.id}/`)[1]);
        return route.fulfill({ body: readFileSync(join(published.dir, path)) });
      });
      await openApp(page, `scene=${published.sceneParam}&view=present`);
      await waitForModel(page);
      expect((await scene(page)).model).toMatchObject({ url: 'model.glb', format: 'glb' });
      await page.keyboard.press('ArrowRight');
      await expect(title(page)).toHaveText('Front end');
      const note = card(page).locator('li.note');
      await expect(note.locator('strong').first()).toHaveText('Hand-built wheels');
      await expect(note.locator('.md li')).toHaveText(['Tubeless', '28 spokes']);
      await expect(card(page).locator('.filmstrip .photo')).toHaveCount(photos.length);
      await expect(card(page).locator('.filmstrip img').first()).toHaveAttribute('src', new RegExp(`/scenes/${published.id}/photos/`));
      await snap(page, testInfo, 'published-capture');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(errors).toEqual([]);
  });
});

test.describe('kiosk', () => {
  test('auto-advances, holds on interaction and resumes when idle', async ({ page }) => {
    test.slow();
    await openApp(page, `${DEMO_LINK}&kiosk=1&interval=1&idle=1`);
    await expect(card(page)).toHaveAttribute('data-kiosk', 'playing');
    await expect(stepLabel(page)).toHaveText('2 / 7', { timeout: 20_000 });
    await expect(stepLabel(page)).toHaveText('3 / 7', { timeout: 20_000 });
    await page.locator('.viewport canvas').dispatchEvent('pointerdown', { bubbles: true });
    await expect(card(page)).toHaveAttribute('data-kiosk', 'held');
    await expect(card(page)).toHaveAttribute('data-kiosk', 'playing', { timeout: 20_000 });
    // K (or the ❚❚ button) stops it.
    await expect(card(page).getByRole('button', { name: 'Stop auto-play' })).toBeVisible();
    await page.keyboard.press('k');
    await expect(card(page)).toHaveAttribute('data-kiosk', 'off');
    await expect(card(page).getByRole('button', { name: 'Auto-play areas' })).toBeVisible();
  });

  test('K toggles auto-play in Present mode', async ({ page }) => {
    await openApp(page, 'mode=present');
    await page.keyboard.press('k');
    await expect(card(page)).toHaveAttribute('data-kiosk', 'playing');
    await page.keyboard.press('k');
    await expect(card(page)).toHaveAttribute('data-kiosk', 'off');
  });
});

test.describe('comment polish in Edit mode', () => {
  test('markdown-lite renders safely', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await tapCanvas(page, await modelPoint(page));
    const form = page.locator('form.editor');
    await form.locator('input[name=title]').fill('XSS check');
    await form.locator('textarea[name=body]').fill('**Bold** and *soft* <img src=x onerror="window.xss=1"><script>window.xss=2</script>\n- one\n- two');
    await form.getByRole('button', { name: 'Save' }).click();
    const md = page.locator('.comment', { hasText: 'XSS check' }).locator('.md');
    await expect(md.locator('strong')).toHaveText('Bold');
    await expect(md.locator('em')).toHaveText('soft');
    await expect(md.locator('li')).toHaveText(['one', 'two']);
    await expect(md).toContainText('<img src=x onerror="window.xss=1"><script>window.xss=2</script>');
    await expect(page.locator('#panel img, #panel script')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { xss?: number }).xss)).toBeUndefined();
  });

  test('reorders comments with ↑ ↓ (and by dragging on desktop); the order persists', async ({ page }, testInfo) => {
    test.slow();
    await openApp(page);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('.areas li', { hasText: 'Fork' }).locator('button').first().click();
    const titles = page.locator('.comments .comment strong');
    await expect(titles).toHaveText(['Full-carbon tapered fork', '12 mm thru-axle']);
    await page.getByRole('button', { name: 'Move “Full-carbon tapered fork” down' }).click();
    await expect(titles).toHaveText(['12 mm thru-axle', 'Full-carbon tapered fork']);
    await expect(page.getByRole('button', { name: 'Move “12 mm thru-axle” up' })).toBeDisabled();
    // Pin numbers follow the order.
    await expect(page.locator('.comments .comment .num')).toHaveText(['1', '2']);

    if (testInfo.project.name === 'desktop') {
      const handle = page.locator('.comments .comment').nth(1).locator('.drag');
      const box = (await handle.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 6 });
      await page.mouse.up();
      await expect(titles).toHaveText(['Full-carbon tapered fork', '12 mm thru-axle']);
      await page.getByRole('button', { name: 'Move “Full-carbon tapered fork” down' }).click();
      await expect(titles).toHaveText(['12 mm thru-axle', 'Full-carbon tapered fork']);
    }

    await page.reload();
    await page.waitForFunction(() => window.__bike?.ready === true);
    expect((await scene(page)).annotations.slice(0, 2).map((a) => a.title)).toEqual(['12 mm thru-axle', 'Full-carbon tapered fork']);
    await page.getByRole('button', { name: 'Present', exact: true }).click();
    await page.keyboard.press('ArrowRight');
    await expect(card(page).locator('li.note > strong')).toHaveText(['12 mm thru-axle', 'Full-carbon tapered fork']);
  });
});
