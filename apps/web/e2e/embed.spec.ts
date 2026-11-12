import { type Page, expect, test } from '@playwright/test';
import { collectErrors, snap } from './helpers';

// embed-demo.html: a stand-in shop page with the iframe embed (embed.html + bike-embed/1 bridge)
// and the <bike-viewer> custom element, both on the published demo scene.

const logLine = (page: Page, re: RegExp) => page.locator('#log li', { hasText: re });

test.describe('embedding', () => {
  test('iframe: postMessage commands drive the bike, events come back', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await page.goto('./embed-demo.html');
    const frame = page.frameLocator('#frame');
    const title = frame.locator('.present-card header strong');
    await expect(logLine(page, /^ready \{"index":0,.*"name":"Demo Road Bike"/)).toHaveCount(1);
    await expect(title).toHaveText('Demo Road Bike');
    // Framed, the embed leaves focus with the shop's page.
    expect(await page.evaluate(() => document.activeElement?.id)).not.toBe('frame');

    await page.getByRole('button', { name: 'Next ›' }).click();
    await expect(title).toHaveText('Fork');
    await expect(logLine(page, /^areachange \{"index":1,"id":"hs-fork","name":"Fork"\}/)).toHaveCount(1);
    await page.getByRole('button', { name: 'Drivetrain' }).click();
    await expect(title).toHaveText('Drivetrain');
    await page.getByRole('button', { name: 'Green screen' }).click();
    await expect(frame.locator('.viewport')).toHaveAttribute('data-background', 'green');
    await page.getByRole('button', { name: 'Get state' }).click();
    await expect(logLine(page, /^state \{"index":2,/)).toHaveCount(1);

    // Malformed or unknown commands are ignored, and the embed keeps working.
    await page.evaluate(() => {
      const w = (document.getElementById('frame') as HTMLIFrameElement).contentWindow!;
      for (const data of ['next', { cmd: 'next' }, { type: 'bike-embed/1', cmd: 'goToArea', area: { id: 'x' } }, { type: 'bike-embed/1', cmd: 'eval', code: 'alert(1)' }]) w.postMessage(data, '*');
      w.postMessage({ type: 'bike-embed/1', cmd: 'prev' }, '*');
    });
    await expect(title).toHaveText('Fork');
    await snap(page, testInfo, 'embed-iframe');
    expect(errors).toEqual([]);
  });

  test('<bike-viewer>: attributes, events and scoped styles', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await page.goto('./embed-demo.html');
    const el = page.locator('#element');
    const title = el.locator('.present-card header strong');
    await expect(logLine(page, /^<bike-viewer> ready/)).toHaveCount(1);
    // `area` picks the opening area; no Share button (it would link the shop's page).
    await expect(title).toHaveText('Cockpit');
    await expect(el.locator('.bp-bar .brand strong')).toHaveText('Demo Road Bike');
    await expect(el.getByRole('button', { name: 'Share' })).toHaveCount(0);

    await el.evaluate((e) => e.setAttribute('area', 'hs-saddle'));
    await expect(title).toHaveText('Saddle & seatpost');
    await expect(logLine(page, /^<bike-viewer> areachange .*"id":"hs-saddle"/)).toHaveCount(1);
    await el.evaluate((e) => e.setAttribute('kiosk', ''));
    await expect.poll(() => el.evaluate((e) => (e as HTMLElement & { presenter: { playing: boolean } }).presenter.playing)).toBe(true);
    await el.evaluate((e) => e.removeAttribute('kiosk'));
    await expect.poll(() => el.evaluate((e) => (e as HTMLElement & { presenter: { playing: boolean } }).presenter.playing)).toBe(false);

    // Styles stay in the shadow root both ways: none of ours on the page, the page's font unchanged.
    const leaked = await page.evaluate(() => [...document.styleSheets].flatMap((s) => [...s.cssRules].map((r) => r.cssText)).filter((t) => /present-card|\.pin\b|--accent/.test(t)));
    expect(leaked).toEqual([]);
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Georgia');
    expect(await el.locator('.bike-present').evaluate((e) => getComputedStyle(e).fontFamily)).toContain('system-ui');

    await el.scrollIntoViewIfNeeded();
    await snap(page, testInfo, 'embed-element');

    // Removing the element tears the presenter down.
    expect(await el.evaluate((e) => (e.remove(), (e as HTMLElement & { presenter: unknown }).presenter))).toBeNull();
    expect(errors).toEqual([]);
  });
});
