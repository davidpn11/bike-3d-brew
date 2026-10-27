import { expect, test } from '@playwright/test';
import { collectErrors, openApp, readDownload, scene, snap, waitForCamera, waitForModel } from './helpers';

test.describe('demo bike', () => {
  test('loads with seeded areas, comments and pins, without console errors', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await openApp(page);
    await waitForModel(page);
    await expect(page.locator('#topbar .brand strong')).toHaveText('Demo Road Bike');
    // Area name + comment count.
    await expect(page.locator('.areas li > button')).toHaveText(['Whole bike7', 'Fork2', 'Drivetrain2', 'Cockpit1', 'Saddle & seatpost1', 'Wheels1', 'Frame0']);
    await expect(page.locator('.comments .comment')).toHaveCount(7);
    await expect(page.locator('.pin-layer .pin')).toHaveCount(7);
    await expect(page.locator('.pin-layer .pin').first()).toHaveAttribute('aria-label', 'Comment 1: Full-carbon tapered fork');
    // Every seeded comment sits on the bike, so at least one pin is on screen.
    await expect(page.locator('.pin-layer .pin:visible').first()).toBeVisible();
    const s = await scene(page);
    expect(s.hotspots).toHaveLength(6);
    expect(s.annotations.every((a) => a.hotspotId)).toBe(true);
    await snap(page, testInfo, 'demo');
    expect(errors).toEqual([]);
  });

  test('flies to an area and back to the whole bike', async ({ page }) => {
    test.info().annotations.push({ type: 'note', description: 'animated flight (reduced motion off)' });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openApp(page);
    await page.getByRole('button', { name: /^Fork \d/ }).click();
    await expect(page.getByRole('button', { name: /^Fork \d/ })).toHaveClass(/\bon\b/);
    // Only the area's comments are listed; other pins are dimmed.
    await expect(page.locator('.comments .comment')).toHaveCount(2);
    await expect(page.locator('.pin-layer .pin.filtered')).toHaveCount(5);
    await expect.poll(() => page.evaluate(() => window.__bike!.viewer.flying)).toBe(false);
    const { view, expected } = await page.evaluate(() => {
      const { viewer, store } = window.__bike!;
      return { view: viewer.getView(), expected: store.scene.hotspots.find((h) => h.name === 'Fork')!.view };
    });
    for (let i = 0; i < 3; i++) {
      expect(view.position[i]).toBeCloseTo(expected.position[i], 2);
      expect(view.target[i]).toBeCloseTo(expected.target[i], 2);
    }
    await page.getByRole('button', { name: /^Whole bike/ }).click();
    await expect(page.locator('.comments .comment')).toHaveCount(7);
    await expect(page.locator('.pin-layer .pin.filtered')).toHaveCount(0);
  });

  test('clicking a comment focuses it and its pin', async ({ page }) => {
    await openApp(page);
    await page.locator('.comments .comment', { hasText: 'Shimano 105 Di2' }).click();
    await expect(page.locator('.comments .comment.on')).toContainText('Shimano 105 Di2');
    await expect(page.locator('.pin-layer .pin.active')).toHaveAttribute('aria-label', /Shimano 105 Di2/);
    await waitForCamera(page);
  });

  test('switches background modes and remembers the choice', async ({ page }, testInfo) => {
    await openApp(page);
    const viewport = page.locator('#viewport');
    await expect(viewport).toHaveAttribute('data-background', 'studio');
    for (const [label, mode] of [
      ['Green', 'green'],
      ['Dark', 'dark'],
      ['Clear', 'transparent'],
      ['Studio', 'studio'],
      ['Green', 'green'],
    ] as const) {
      await page.locator(`[data-bg="${mode}"]`).click();
      await expect(viewport).toHaveAttribute('data-background', mode);
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveClass(/\bon\b/);
      // Chroma green renders an opaque clear color so it keys cleanly; the others are see-through (CSS backdrop).
      expect(await page.evaluate(() => window.__bike!.viewer.renderer.getClearAlpha())).toBe(mode === 'green' ? 1 : 0);
    }
    await snap(page, testInfo, 'green-background');
    await page.reload();
    await page.waitForFunction(() => window.__bike?.ready === true);
    await expect(viewport).toHaveAttribute('data-background', 'green');
  });

  test('snapshot downloads a PNG of the stage', async ({ page }) => {
    await openApp(page);
    await waitForModel(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Snapshot' }).click()]);
    expect(download.suggestedFilename()).toBe('demo-road-bike.png');
    const png = await readDownload(download);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.length).toBeGreaterThan(5_000); // a real render, not an empty canvas
  });

  test('reset view returns to the overview', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: /^Cockpit \d/ }).click();
    await waitForCamera(page);
    await page.getByRole('button', { name: 'Reset view' }).click();
    await waitForCamera(page);
    const same = await page.evaluate(() => {
      const { viewer } = window.__bike!;
      const a = viewer.getView();
      const b = viewer.overviewView();
      return a.position.every((v, i) => Math.abs(v - b.position[i]) < 1e-3);
    });
    expect(same).toBe(true);
    await expect(page.getByRole('button', { name: /^Whole bike/ })).toHaveClass(/\bon\b/);
  });
});
